const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const rootFiles = ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'nest-cli.json', 'prisma.config.ts', 'Dockerfile', 'docker-compose.yml', '.env.example'];
function filesIn(directory) {
  if (!fs.existsSync(path.join(root, directory))) return [];
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return filesIn(relative);
    return entry.isFile() ? [relative] : [];
  });
}
function sourceFiles() {
  return [...rootFiles.filter((file) => fs.existsSync(path.join(root, file))), ...filesIn('src').filter((file) => !file.startsWith('src/generated/')), 'prisma/schema.prisma', ...filesIn('benchmarks').filter((file) => !/^benchmarks\/(?:\.generated|\.tools|results|__pycache__|\.pytest_cache)\//.test(file) && file !== 'benchmarks/source-provenance.json')].sort();
}
function sourceProvenance() {
  const hash = crypto.createHash('sha256');
  for (const file of sourceFiles()) { hash.update(file + '\0'); hash.update(fs.readFileSync(path.join(root, file))); hash.update('\0'); }
  const sourceTree = `sha256:${hash.digest('hex')}`;
  const workloadSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'benchmarks/workload.js'))).digest('hex');
  let gitCommit;
  let gitDirty;
  try {
    gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    gitDirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim());
  } catch {
    const saved = JSON.parse(fs.readFileSync(path.join(root, 'benchmarks/source-provenance.json'), 'utf8'));
    if (saved.sourceTree !== sourceTree || saved.workloadSha256 !== workloadSha256) throw new Error('Uploaded source does not match its provenance manifest.');
    ({ gitCommit, gitDirty } = saved);
  }
  if (!/^[a-f\d]{40}$/i.test(gitCommit)) throw new Error('Source Git commit is missing.');
  return { gitCommit, gitDirty, sourceTree, workloadSha256 };
}
module.exports = { root, sourceFiles, sourceProvenance };
