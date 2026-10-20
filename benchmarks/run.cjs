const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { root, sourceProvenance } = require('./source.cjs');
const { validateDatabaseUrl, makeClient, seedFixture, cleanupFixture } = require('./fixtures.cjs');
const { main: report } = require('./report.cjs');
const config = require('./config.json');

function execute(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd: root, windowsHide: true, stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Process exited unsuccessfully (${code ?? signal}).`)));
  });
}
function kaggleCpuVerified() {
  if (process.platform !== 'linux' || !fs.existsSync('/kaggle/working') || !Object.keys(process.env).some((key) => key.startsWith('KAGGLE_'))) return false;
  if (/gpu|tpu/i.test(process.env.KAGGLE_ACCELERATOR || '') || (process.env.CUDA_VISIBLE_DEVICES && !['-1', ''].includes(process.env.CUDA_VISIBLE_DEVICES))) return false;
  try {
    const devices = execFileSync('nvidia-smi', ['-L'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    if (/GPU \d/.test(devices)) return false;
  } catch { /* CPU kernels do not expose nvidia-smi. */ }
  return true;
}
async function checkPort(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`Benchmark API port ${port} is busy; existing services will not be replaced.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
async function ready(child, url) {
  const until = Date.now() + 45000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error('Disposable benchmark API exited before readiness; see ignored API log.');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch { /* Poll until ready, without exposing logs or environment variables. */ }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('Disposable benchmark API readiness timed out.');
}
async function main(argv) {
  if (argv.length !== 2 || argv[0] !== '--environment' || !['local', 'kaggle-cpu'].includes(argv[1])) throw new Error('Usage: node benchmarks/run.cjs --environment local|kaggle-cpu');
  const environment = argv[1];
  const kaggleVerified = kaggleCpuVerified();
  if (environment === 'kaggle-cpu' && !kaggleVerified) throw new Error('A real Kaggle CPU kernel is required; local results cannot be labeled Kaggle.');
  if (process.versions.node !== config.nodeVersion) throw new Error(`Use pinned Node ${config.nodeVersion} for reproducible baseline measurements.`);
  const databaseUrl = validateDatabaseUrl(process.env.BENCH_DATABASE_URL);
  const k6Binary = path.resolve(process.env.K6_BINARY || path.join(__dirname, '.tools', process.platform === 'win32' ? 'k6.exe' : 'k6'));
  const k6Version = execFileSync(k6Binary, ['version'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  if (!k6Version.includes(`v${config.k6Version} `)) throw new Error(`Use pinned k6 ${config.k6Version}.`);
  const client = makeClient(databaseUrl);
  let mongoVersion;
  try {
    const info = await client.$runCommandRaw({ buildInfo: 1 });
    mongoVersion = String(info.version);
    if (!mongoVersion.startsWith('8.0.')) throw new Error('This baseline requires MongoDB 8.0.x.');
    const counts = await Promise.all(['user', 'exam', 'question', 'option', 'attempt', 'attemptAnswer', 'revokedToken'].map((model) => client[model].count()));
    if (counts.some((count) => count > 0)) throw new Error('Benchmark database is not empty; choose a fresh database before schema synchronization.');
  } finally { await client.$disconnect(); }
  const runId = `${environment}-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
  const generated = path.join(__dirname, '.generated', runId);
  const results = path.join(__dirname, 'results');
  fs.mkdirSync(generated, { recursive: true });
  fs.mkdirSync(results, { recursive: true });
  const fixtureFile = path.join(generated, 'fixture.json');
  const ownershipFile = path.join(generated, 'owned-ids.json');
  const summaryFile = path.join(results, `${runId}.summary.json`);
  const reportFile = path.join(results, `${runId}.md`);
  const provenance = { environment, runId, ...sourceProvenance(), startedAt: new Date().toISOString(), dataset: config.dataset,
    runtime: { platform: process.platform, kaggleVerified, accelerator: 'none', cpuCount: os.cpus().length, cpuModel: os.cpus()[0]?.model || 'unknown', nodeVersion: process.version, mongoVersion, k6Version } };
  const port = 3100;
  let api;
  let log;
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  try {
    await checkPort(port);
    // Build here so a stale dist directory cannot be measured as the current source.
    const childEnv = { ...process.env, DATABASE_URL: databaseUrl, PORT: String(port), JWT_SECRET: crypto.randomBytes(48).toString('hex'), JWT_EXPIRES_IN: '3600', NODE_ENV: 'production' };
    await execute(process.execPath, ['node_modules/prisma/build/index.js', 'generate'], { env: childEnv });
    await execute(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], { env: childEnv });
    await execute(process.execPath, ['node_modules/@nestjs/cli/bin/nest.js', 'build'], { env: childEnv });
    const fixture = await seedFixture(databaseUrl, config, provenance, ownershipFile);
    fs.writeFileSync(fixtureFile, JSON.stringify(fixture, null, 2), { mode: 0o600 });
    log = fs.openSync(path.join(generated, 'api.log'), 'w');
    api = spawn(process.execPath, ['dist/main.js'], { cwd: root, env: childEnv, windowsHide: true, stdio: ['ignore', log, log] });
    await ready(api, `http://127.0.0.1:${port}/docs-json`);
    console.log(`Running ${environment}: ${config.virtualUsers} VUs, ${config.warmupDuration} warmup, ${config.duration} measured. Primary database is untouched.`);
    let loadError;
    try {
      await execute(k6Binary, ['run', '--quiet', '--no-usage-report', '--new-machine-readable-summary=false', 'benchmarks/workload.js'], { env: { ...process.env, K6_NEW_MACHINE_READABLE_SUMMARY: 'false', BASE_URL: baseUrl, DATA_FILE: fixtureFile, SUMMARY_FILE: summaryFile, VUS: String(config.virtualUsers), DURATION: config.duration, WARMUP_DURATION: config.warmupDuration } });
    } catch (error) { loadError = error; }
    if (fs.existsSync(summaryFile)) report([summaryFile, '--environment', environment, '--output', reportFile]);
    if (loadError) throw loadError;
    if (!fs.existsSync(reportFile)) throw new Error('k6 produced no validated report.');
    console.log(`Measured report: ${reportFile}`);
  } finally {
    if (api && api.exitCode === null) {
      const exited = new Promise((resolve) => api.once('exit', resolve));
      api.kill();
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
    }
    if (log !== undefined) fs.closeSync(log);
    await cleanupFixture(databaseUrl, ownershipFile);
    if (fs.existsSync(fixtureFile)) fs.unlinkSync(fixtureFile);
  }
}
module.exports = { main, kaggleCpuVerified };
if (require.main === module) main(process.argv.slice(2)).catch((error) => { console.error(`Benchmark stopped: ${error.message}`); process.exitCode = 1; });
