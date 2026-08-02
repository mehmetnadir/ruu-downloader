/**
 * Saha testi — 2. adım: GERÇEK paylaşım linklerini uzantıyla indirtip doğrular.
 *
 * Her link için: share-fetch → akış izlenir → inen dosya boyut+desen ile
 * doğrulanır → karar günlüğü raporlanır. Sonuç servis servis tablo.
 *
 * Kullanım:
 *   node test/field/run-field.mjs <cdpPort> <extId> <linksJson> <downloadDir> [beklenenByte]
 *   node test/field/run-field.mjs 9270 <id> - <dir> 3145728 "https://..." "https://..."
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';

const [cdpPort, extId, linksJson, downloadDir, sizeArg, ...extraUrls] = process.argv.slice(2);
if (!downloadDir) {
  console.error('kullanım: run-field.mjs <cdpPort> <extId> <links.json|-> <dir> [size] [url…]');
  process.exit(2);
}
mkdirSync(downloadDir, { recursive: true });

const entries = [];
if (linksJson && linksJson !== '-') {
  const data = JSON.parse(readFileSync(linksJson, 'utf8'));
  for (const l of data.links) if (l.page) entries.push({ service: l.service, url: l.page, size: data.size });
}
for (const u of extraUrls) {
  entries.push({ service: new URL(u).hostname.replace(/^www\./, ''), url: u, size: Number(sizeArg) || 0 });
}
if (entries.length === 0) { console.error('link yok'); process.exit(2); }

// ── CDP ──────────────────────────────────────────────────────────────────────
class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl); this.id = 0; this.pending = new Map();
    this.ready = new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = () => rej(new Error('WS')); });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
    };
  }
  async call(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error('zaman aşımı')); }, 20000);
    });
  }
  close() { this.ws.close(); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalIn = async (cdp, expr) => {
  const r = await cdp.call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

function verify(path, expectedSize) {
  const b = readFileSync(path);
  if (expectedSize && b.length !== expectedSize) return `boyut ${b.length} ≠ ${expectedSize}`;
  for (let i = 0; i < b.length; i++) if (b[i] !== i % 251) return `byte ${i} bozuk`;
  return null;
}
const snapshot = () => new Set(existsSync(downloadDir) ? readdirSync(downloadDir) : []);
function newFiles(before) {
  return readdirSync(downloadDir).filter((f) => !before.has(f) && !f.endsWith('.crdownload'));
}

// ── koşu ─────────────────────────────────────────────────────────────────────
const version = await (await fetch(`http://localhost:${cdpPort}/json/version`)).json();
const browser = new Cdp(version.webSocketDebuggerUrl);
await browser.call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
await browser.call('Target.createTarget', { url: `chrome-extension://${extId}/sidepanel.html` });
await sleep(1500);
const ts = await (await fetch(`http://localhost:${cdpPort}/json`)).json();
const panel = new Cdp(ts.find((t) => t.url.includes('sidepanel.html')).webSocketDebuggerUrl);
// eşik 0: saha testinde küçük dosyalar da motora gitsin
await evalIn(panel, `chrome.storage.local.set({takeoverMinMB:0}); 'ok'`);

const rows = [];
for (const e of entries) {
  const before = snapshot();
  await evalIn(panel, `chrome.storage.local.set({takeoverLog:[]}); 'ok'`);
  await evalIn(panel, `chrome.runtime.sendMessage({target:'sw',type:'share-fetch',url:${JSON.stringify(e.url)}}); 'ok'`);

  let found = null;
  const deadline = Date.now() + 75_000;
  while (Date.now() < deadline && !found) {
    await sleep(1500);
    const fresh = newFiles(before);
    for (const f of fresh) {
      const p = `${downloadDir}/${f}`;
      if (statSync(p).size > 0 && (!e.size || statSync(p).size === e.size)) { found = p; break; }
    }
  }
  const log = await evalIn(panel,
    `chrome.storage.local.get({takeoverLog:[]}).then(s=>s.takeoverLog.map(x=>x.action).join('>'))`);
  const bad = found ? verify(found, e.size) : 'dosya inmedi';
  rows.push({ service: e.service, ok: !bad, note: bad ?? 'bütünlük tam', log });
  console.log(`${bad ? 'FAIL' : 'PASS'}  ${e.service.padEnd(16)} ${bad ?? 'bütünlük tam'}  [${log}]`);
  if (found) unlinkSync(found);
}

panel.close(); browser.close();
const pass = rows.filter((r) => r.ok).length;
console.log(`\n${pass}/${rows.length} servis gerçek linkle doğrulandı`);
process.exit(pass === rows.length ? 0 : 1);
