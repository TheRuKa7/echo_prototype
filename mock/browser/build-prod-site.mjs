// Builds the GitHub Pages copy of the live clone: the live build in prod/ plus the mock in a
// service worker, with the live API hosts taken out.
//   node mock/browser/build-prod-site.mjs [out=site] [base=/echo_prototype/]
// ESBUILD_PATH / NODE_PATH may point at an esbuild and node_modules outside this repo.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { build } = await import(process.env.ESBUILD_PATH ? pathToFileURL(process.env.ESBUILD_PATH).href : 'esbuild');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const OUT = process.argv[2] || 'site';
const BASE = process.argv[3] || '/echo_prototype/';
const PROD = here('../../prod/');

// The build's API bases -> the service worker's mock paths (same split as sw.mjs: api and rtc). Matched by
// setting name, so the live hosts are never written here. The app builds `new URL(base + path)`, so the
// bases stay absolute: this page's origin plus the path.
const REWRITE = [
  [/apiBase:"https:\/\/[^"]+"/g, `apiBase:location.origin+"${BASE}__mock/api"`],
  [/webrtcBase:"https:\/\/[^"]+"/g, `webrtcBase:location.origin+"${BASE}__mock/rtc"`],
];
// Any other https host left in the app or the mock fails the build, apart from these public ones.
const PUBLIC_HOSTS = ['angular.dev', 'www.w3.org', 'fonts.googleapis.com', 'fonts.gstatic.com', 'example.com',
  'schemas.openxmlformats.org', 'purl.org', 'schemas.microsoft.com', // .xlsx XML namespaces
  'feross.org']; // the buffer package's licence comment
const liveHost = (s) => [...s.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)].map((m) => m[1].toLowerCase()).find((h) => !PUBLIC_HOSTS.some((p) => h === p || h.endsWith('.' + p)));
const LIVE_HOSTS = { test: (s) => !!liveHost(s) };

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const scripts = [];
for (const f of readdirSync(PROD)) {
  if (f.endsWith('.js')) {
    let s = readFileSync(PROD + f, 'utf8');
    for (const [a, b] of REWRITE) s = s.replace(a, b);
    if (LIVE_HOSTS.test(s)) throw new Error(`${f} still names a live host: ${liveHost(s)}`);
    writeFileSync(`${OUT}/${f}`, s);
  } else if (f !== 'index.html') copyFileSync(PROD + f, `${OUT}/${f}`);
}

// Start the mock first, then load the app's scripts in their original order.
let html = readFileSync(PROD + 'index.html', 'utf8').replace('<base href="/">', `<base href="${BASE}">`)
  .replace(/<script src="([^"]+\.js)" type="module"><\/script>/g, (_, src) => { scripts.push(src); return ''; });
if (!scripts.length) throw new Error('index.html: app script tags not found');
const boot = `<script>
(async () => {
  const base = document.baseURI;
  // GitHub Pages answers every unknown path with this page, including deep links into next/: send those to next/.
  const next = new URL('next/', base);
  if (location.pathname.startsWith(next.pathname)) { location.replace(next.href); return; }
  try {
    await navigator.serviceWorker.register(new URL('mock-sw.js', base), { scope: new URL('./', base).pathname });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
  } catch (e) { document.body.textContent = 'This demo needs a browser with service workers.'; return; }
  for (const src of ${JSON.stringify(scripts)}) { const s = document.createElement('script'); s.type = 'module'; s.src = src; document.body.appendChild(s); }
})();
</script>`;
html = html.replace('</body>', `${boot}</body>`);
writeFileSync(`${OUT}/index.html`, html);
// GitHub Pages serves 404.html for deep links; it boots the same app.
copyFileSync(`${OUT}/index.html`, `${OUT}/404.html`);

await build({
  entryPoints: [here('./sw.mjs')], bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify: true,
  outfile: `${OUT}/mock-sw.js`, inject: [here('./globals.mjs')], define: { 'globalThis.__ECHO_DEMO__': 'true', 'import.meta.url': '"file:///mock/server.mjs"' },
  alias: { 'node:fs': here('./fs.mjs'), 'node:http': here('./http.mjs'), 'node:crypto': here('./crypto.mjs'), 'node:zlib': here('./zlib.mjs') },
  nodePaths: process.env.NODE_PATH ? process.env.NODE_PATH.split(';') : [],
  loader: { '.json': 'json' }, logLevel: 'warning',
});
const sw = readFileSync(`${OUT}/mock-sw.js`, 'utf8');
if (LIVE_HOSTS.test(sw)) throw new Error(`mock-sw.js names a live host: ${liveHost(sw)}`);
console.log(`Pages site built in ${OUT} for ${BASE}`);
