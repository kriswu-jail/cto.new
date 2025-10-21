// Minimal Node integration script to call worker endpoints with signed requests
// Requires Node >= 18 (global fetch and crypto)

import crypto from 'node:crypto';

const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8080';
const SECRET = process.env.WORKER_SHARED_SECRET || 'dev-secret';

function sign(ts, body) {
  const h = crypto.createHmac('sha256', SECRET);
  h.update(`${ts}.`);
  h.update(Buffer.isBuffer(body) ? body : Buffer.from(body));
  return h.digest('hex');
}

async function call(method, path, json) {
  const bodyStr = json ? JSON.stringify(json) : '';
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = sign(ts, bodyStr);
  const res = await fetch(`${WORKER_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-timestamp': ts,
      'x-signature': sig,
    },
    body: method === 'GET' ? undefined : bodyStr,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Request failed ${res.status}: ${text}`);
  }
  return res.json();
}

async function main() {
  const hs = await call('GET', '/handshake');
  console.log('Handshake:', hs);

  const job = {
    id: 'node-test',
    type: 'ocr',
    payload: {
      source_url: 'https://example.com/input.pdf',
      lang: 'ch',
    },
  };
  const res = await call('POST', '/jobs', job);
  console.log('Job result:', res);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
