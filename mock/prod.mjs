// `npm run start:prod`: today's live Echo console (the built files copied from
// voice-ai-platform.cognilix.com into prod/) served against the local mock.
// Nothing reaches the real backend: the live API origins are rewritten to the mock.
// Open http://localhost:4240 and sign in with any email and password.
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import './server.mjs'; // starts the mock on :8090 (dataload) and :8080 (voice backend)

const APP_PORT = Number(process.env.ECHO_PROD_PORT || 4240);
const DIR = fileURLToPath(new URL('../prod/', import.meta.url));
const REWRITE = [
  ['https://voice-agent-dataload.cognilix.com', `http://localhost:${process.env.ECHO_API_PORT || 8090}`],
  ['https://voice-agent.cognilix.com', `http://localhost:${process.env.ECHO_WEBRTC_PORT || 8080}`],
];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

http.createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[\\/]+/, '');
  let file = join(DIR, path);
  // App routes (no file extension) get the app shell, like nginx try_files.
  if (!file.startsWith(DIR) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIR, 'index.html');
  let body = readFileSync(file);
  if (file.endsWith('.js')) { let s = body.toString('utf8'); for (const [a, b] of REWRITE) s = s.split(a).join(b); body = Buffer.from(s); }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(body);
}).listen(APP_PORT, () => console.log(`[echo-prod] live console on http://localhost:${APP_PORT} (mock data)`));
