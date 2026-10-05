const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const version = require('./config.json').k6Version;
const assets = {
  win32: { archive: `k6-v${version}-windows-amd64.zip`, sha256: '6a6c029bd98cdbe245dbc7305755783d45a31a01a75d4377533f8d88021685dc', binary: 'k6.exe' },
  linux: { archive: `k6-v${version}-linux-amd64.tar.gz`, sha256: '68df4958a1b089dc6f70a234e07c7ec818922f83b261ca24f3abf79882b13343', binary: 'k6' },
};
async function main() {
  const asset = assets[process.platform];
  if (!asset || process.arch !== 'x64') throw new Error('Pinned installer supports Windows/Linux x64.');
  const target = path.join(__dirname, '.tools');
  fs.mkdirSync(target, { recursive: true });
  const filename = path.join(target, asset.archive);
  const response = await fetch(`https://github.com/grafana/k6/releases/download/v${version}/${asset.archive}`, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Official k6 download returned HTTP ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('Official k6 archive SHA256 mismatch.');
  fs.writeFileSync(filename, bytes);
  const unpacked = path.join(target, 'unpacked');
  fs.mkdirSync(unpacked, { recursive: true });
  if (process.platform === 'win32') {
    const literal = (value) => `'${value.replace(/'/g, "''")}'`;
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${literal(filename)} -DestinationPath ${literal(unpacked)} -Force`], { windowsHide: true, stdio: 'inherit' });
  } else execFileSync('tar', ['-xzf', filename, '-C', unpacked], { stdio: 'inherit' });
  const binary = path.join(unpacked, `k6-v${version}-${process.platform === 'win32' ? 'windows' : 'linux'}-amd64`, asset.binary);
  fs.copyFileSync(binary, path.join(target, asset.binary));
  if (process.platform !== 'win32') fs.chmodSync(path.join(target, asset.binary), 0o755);
  console.log(`Verified k6 ${version}: ${path.join(target, asset.binary)}`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
