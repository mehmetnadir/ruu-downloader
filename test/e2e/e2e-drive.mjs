/**
 * Ruu E2E sürücüsü — CDP üzerinden 3 senaryo koşar, bütünlük doğrular.
 * run.sh tarafından çağrılır; tek başına da çalışır (tarayıcı + sunucu hazırsa).
 *
 * Kullanım: node test/e2e/e2e-drive.mjs <cdpPort> <extId> <serverPort> <downloadDir>
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';

const [cdpPort, extId, serverPort, downloadDir] = process.argv.slice(2);
if (!downloadDir) {
  console.error('kullanım: e2e-drive.mjs <cdpPort> <extId> <serverPort> <downloadDir>');
  process.exit(2);
}

// ── küçük CDP istemcisi ──────────────────────────────────────────────────────
class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = () => rej(new Error('WS bağlanamadı'));
    });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg);
        this.pending.delete(msg.id);
      }
    };
  }
  async call(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, (msg) => msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result));
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`${method} zaman aşımı`)); }, 15000);
    });
  }
  close() { this.ws.close(); }
}

const targets = async () => (await fetch(`http://localhost:${cdpPort}/json`)).json();

async function pageCdp(urlPart, retries = 20) {
  for (let i = 0; i < retries; i++) {
    const t = (await targets()).find((t) => t.url.includes(urlPart));
    if (t) return new Cdp(t.webSocketDebuggerUrl);
    await sleep(250);
  }
  throw new Error(`hedef bulunamadı: ${urlPart}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evalIn(cdp, expression) {
  const r = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error(`eval: ${d.text} ${d.exception?.description ?? d.exception?.value ?? ''}`);
  }
  return r.result.value;
}

function verifyPattern(path) {
  const buf = readFileSync(path);
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== i % 251) return `byte ${i} bozuk`;
  }
  return null;
}

// ── senaryolar ───────────────────────────────────────────────────────────────
const results = [];
const record = (name, ok, note = '') => {
  results.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ` — ${note}` : ''}`);
};

const version = await (await fetch(`http://localhost:${cdpPort}/json/version`)).json();
const browser = new Cdp(version.webSocketDebuggerUrl);

// indirilen dosyalar temp dizine insin
await browser.call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });

// panel sekmesi aç (SW + offscreen uyanır)
await browser.call('Target.createTarget', { url: `chrome-extension://${extId}/sidepanel.html` });
const panel = await pageCdp('sidepanel.html');
await sleep(1500); // offscreen + engine yüklensin

async function addAndWait(url, name, timeoutSec, expectState = 'done') {
  await evalIn(panel, `chrome.runtime.sendMessage({target:'sw',type:'add',url:${JSON.stringify(url)}}); 'sent'`);
  const offscreen = await pageCdp('offscreen.html');
  const deadline = Date.now() + timeoutSec * 1000;
  let last = '';
  while (Date.now() < deadline) {
    await sleep(700);
    const st = await evalIn(offscreen,
      `(()=>{const js=[...__ruu.jobs.values()];const j=js.find(x=>x.url===${JSON.stringify(url)});` +
      `return j? j.state : 'yok'})()`);
    last = st;
    if (st === expectState || st === 'error') break;
  }
  offscreen.close();
  return last;
}

/**
 * Boyuta göre bul: CDP setDownloadBehavior blob indirmelerini GUID adla kaydediyor
 * (normal kullanımda adlar doğru — manuel denemelerle kanıtlı), ad güvenilmez.
 */
function findFile(expectedBytes) {
  if (!existsSync(downloadDir)) return null;
  for (const f of readdirSync(downloadDir)) {
    if (f.endsWith('.crdownload')) continue;
    const p = `${downloadDir}/${f}`;
    if (statSync(p).size === expectedBytes) return p;
  }
  return null;
}

const MB = 1024 * 1024;

// S1: segmentli indirme + bütünlük
{
  const st = await addAndWait(`http://localhost:${serverPort}/f/60?rate=30`, 'S1', 45);
  let file = null;
  for (let i = 0; i < 20 && !file; i++) { await sleep(500); file = findFile(60 * MB); }
  const bad = file ? verifyPattern(file) : 'dosya yok';
  record('S1 segmentli 60MB + bütünlük', st === 'done' && !bad, bad ?? `state=${st}`);
}

// S2: %50 kesintili sunucu → retry + bütünlük
{
  const st = await addAndWait(`http://localhost:${serverPort}/f/30?rate=30&dropAfter=0.5`, 'S2', 60);
  let file = null;
  for (let i = 0; i < 20 && !file; i++) { await sleep(500); file = findFile(30 * MB); }
  const bad = file ? verifyPattern(file) : 'dosya yok';
  record('S2 kesintili 30MB + bütünlük', st === 'done' && !bad, bad ?? `state=${st}`);
}

// S3: Range'siz sunucu → native fallback
{
  const st = await addAndWait(`http://localhost:${serverPort}/f/10?noRange=1`, 'S3', 30);
  let file = null;
  for (let i = 0; i < 20 && !file; i++) { await sleep(500); file = findFile(10 * MB); }
  const bad = file ? verifyPattern(file) : 'dosya yok';
  record('S3 noRange → native fallback', st === 'done' && !bad, bad ?? `state=${st}`);
}

// S4: DEVRALMA — tarayıcının kendi başlattığı indirmeyi Ruu yakalar (PRD F1)
{
  const url = `http://localhost:${serverPort}/f/15?rate=30`;
  // sekmeye git → sunucu Content-Disposition: attachment döner → tarayıcı indirme başlatır
  await browser.call('Target.createTarget', { url });
  const offscreen = await pageCdp('offscreen.html');
  const deadline = Date.now() + 40_000;
  let st = 'yok';
  while (Date.now() < deadline) {
    await sleep(700);
    st = await evalIn(offscreen,
      `(()=>{const j=[...__ruu.jobs.values()].find(x=>x.url===${JSON.stringify(url)});` +
      `return j? j.state : 'yok'})()`);
    if (st === 'done' || st === 'error') break;
  }
  offscreen.close();
  let file = null;
  for (let i = 0; i < 20 && !file; i++) { await sleep(500); file = findFile(15 * MB); }
  const bad = file ? verifyPattern(file) : 'dosya yok';
  record('S4 tarayıcı indirmesini devralma', st === 'done' && !bad, bad ?? `state=${st}`);
}

browser.close();
panel.close();

const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} senaryo geçti`);
process.exit(fails ? 1 : 0);
