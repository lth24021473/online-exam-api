const fs = require('node:fs');
const path = require('node:path');
async function main() {
  const repositories = ['lth24021473/online-exam-api', 'lth24021473/online-exam-front'];
  const results = [];
  for (const repository of repositories) {
    const response = await fetch(`https://api.github.com/repos/${repository}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'online-exam-phase1-public-check' },
      signal: AbortSignal.timeout(20000),
    });
    let body;
    try { body = await response.json(); } catch { body = {}; }
    const verifiedPublic = response.status === 200 && body.full_name === repository && body.private === false && body.visibility === 'public';
    results.push({ repository, url: `https://github.com/${repository}`, anonymousHttpStatus: response.status, verifiedPublic,
      result: verifiedPublic ? 'public' : response.status === 404 ? 'not publicly accessible: private, absent, or hidden; owner verification needed' : 'public verification failed; inspect GitHub response status' });
  }
  const checkedAt = new Date().toISOString();
  const report = { checkedAt, method: 'GitHub REST repository metadata without Authorization or cookies', repositories: results, allPublic: results.every((entry) => entry.verifiedPublic) };
  const directory = path.join(__dirname, 'results');
  fs.mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, 'github-public-check.json');
  fs.writeFileSync(filename, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.allPublic) process.exitCode = 1;
}
main().catch((error) => { console.error(`Public check failed: ${error.message}`); process.exitCode = 1; });
