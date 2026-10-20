const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { root, sourceFiles, sourceProvenance } = require('./source.cjs');
const output = path.join(__dirname, '.generated');
fs.mkdirSync(output, { recursive: true });
const provenance = sourceProvenance();
const manifest = 'benchmarks/source-provenance.json';
fs.writeFileSync(path.join(root, manifest), JSON.stringify(provenance, null, 2));
try {
  const archive = path.join(output, 'source.tar.gz');
  const files = [...sourceFiles(), manifest];
  execFileSync('tar', ['-czf', archive, ...files], { cwd: root, stdio: 'inherit', windowsHide: true });
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  fs.writeFileSync(`${archive}.sha256`, `${sha256}  source.tar.gz\n`);
  console.log(`Kaggle input: ${archive}\nSHA256: ${sha256}\nApp source, dependencies and benchmark only; .env, .git, users, database and local logs are excluded.`);
} finally { fs.unlinkSync(path.join(root, manifest)); }
