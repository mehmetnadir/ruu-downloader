/**
 * Beam Worker deploy — Cloudflare REST API (wrangler bu makinede bozuk:
 * workerd platform uyumsuzluğu). KV namespace'i yoksa oluşturur, Worker'ı
 * multipart olarak yükler, workers.dev alt alanını açar.
 *
 * Kimlik: ~/.cloudflare/auth.env (CLOUDFLARE_AUTH_EMAIL + CLOUDFLARE_AUTH_KEY)
 * Kullanım: node beam/deploy.mjs [accountId]
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const env = Object.fromEntries(
  readFileSync(`${homedir()}/.cloudflare/auth.env`, 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      // 'export KEY=value' biçimini de kabul et
      const key = l.slice(0, i).trim().replace(/^export\s+/, '');
      return [key, l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const H = {
  'X-Auth-Email': env['CLOUDFLARE_AUTH_EMAIL'],
  'X-Auth-Key': env['CLOUDFLARE_AUTH_KEY'],
};
const API = 'https://api.cloudflare.com/client/v4';
const WORKER = 'ruu-beam';

const call = async (path, init = {}) => {
  const r = await fetch(`${API}${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  const j = await r.json().catch(() => ({ success: false, errors: [{ message: `HTTP ${r.status}` }] }));
  if (!j.success) throw new Error(`${path}: ${JSON.stringify(j.errors ?? j)}`);
  return j.result;
};

const accountId = process.argv[2] ?? (await call('/accounts'))[0].id;
console.log('hesap:', accountId);

// 1) KV namespace (varsa yeniden kullan)
const namespaces = await call(`/accounts/${accountId}/storage/kv/namespaces?per_page=100`);
let ns = namespaces.find((n) => n.title === 'ruu-beam-queue');
if (!ns) {
  ns = await call(`/accounts/${accountId}/storage/kv/namespaces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'ruu-beam-queue' }),
  });
  console.log('KV oluşturuldu:', ns.id);
} else {
  console.log('KV mevcut:', ns.id);
}

// 2) PWA varlıklarını worker'a göm (ayrı hosting gerekmesin)
const pwaFiles = ['index.html', 'app.js', 'manifest.webmanifest', 'sw.js'];
const assets = Object.fromEntries(pwaFiles.map((f) => [
  f, readFileSync(new URL(`./pwa/${f}`, import.meta.url), 'utf8'),
]));

// 3) Worker yükle (ES module + KV binding)
const script = readFileSync(new URL('./worker.js', import.meta.url), 'utf8')
  .replace('/*__PWA_ASSETS__*/{}', JSON.stringify(assets));
const metadata = {
  main_module: 'worker.js',
  compatibility_date: '2026-01-01',
  bindings: [{ type: 'kv_namespace', name: 'BEAM', namespace_id: ns.id }],
};
const form = new FormData();
form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
form.append('worker.js', new Blob([script], { type: 'application/javascript+module' }), 'worker.js');

await call(`/accounts/${accountId}/workers/scripts/${WORKER}`, { method: 'PUT', body: form });
console.log('worker yüklendi:', WORKER);

// 3) workers.dev alt alanını aç
await call(`/accounts/${accountId}/workers/scripts/${WORKER}/subdomain`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ enabled: true }),
});

const sub = await call(`/accounts/${accountId}/workers/subdomain`);
console.log(`\n✓ Beam relay: https://${WORKER}.${sub.subdomain}.workers.dev`);
