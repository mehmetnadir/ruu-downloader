/**
 * Ruu E2E sürücüsü — CDP üzerinden 3 senaryo koşar, bütünlük doğrular.
 * run.sh tarafından çağrılır; tek başına da çalışır (tarayıcı + sunucu hazırsa).
 *
 * Kullanım: node test/e2e/e2e-drive.mjs <cdpPort> <extId> <serverPort> <downloadDir>
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { spawn, execSync } from 'node:child_process';

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

// S5: CRASH-RESUME — indirme ortasında tarayıcıyı öldür, yeniden başlat, devam ettir (PRD F3)
{
  const url = `http://localhost:${serverPort}/f/80?rate=2`;
  await evalIn(panel, `chrome.runtime.sendMessage({target:'sw',type:'add',url:${JSON.stringify(url)}}); 'sent'`);
  let offscreen = await pageCdp('offscreen.html');
  // ~%25'e kadar in
  let dlBefore = 0;
  const d1 = Date.now() + 40_000;
  while (Date.now() < d1) {
    await sleep(500);
    dlBefore = await evalIn(offscreen,
      `(()=>{const j=[...__ruu.jobs.values()].find(x=>x.url===${JSON.stringify(url)});` +
      `return j&&j.alloc? j.alloc.downloadedBytes() : 0})()`);
    if (dlBefore > 20 * MB) break;
  }
  offscreen.close();
  browser.close();
  panel.close();

  // öldür — SIGKILL: gerçek crash simülasyonu. SIGTERM'de Chrome nazikçe kapanır
  // ve CDP-yüklü unpacked uzantıyı kaldırıp OPFS'ini TEMİZLER (kalıcı kurulumda
  // olmayan bir test-ortamı artefaktı). -9 bu temizliğe fırsat vermez.
  try { execSync(`pkill -9 -f "${process.env.RUU_PROFILE}"`); } catch { /* çıkış kodu önemsiz */ }
  await sleep(2500);
  const args = [
    ...(process.env.RUU_HEADLESS === '1' ? ['--headless=new'] : []),
    `--user-data-dir=${process.env.RUU_PROFILE}`,
    `--remote-debugging-port=${cdpPort}`,
    '--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check',
  ];
  spawn(process.env.RUU_CHROME, args, { detached: true, stdio: 'ignore' }).unref();
  const d2 = Date.now() + 20_000;
  for (;;) {
    try { await fetch(`http://localhost:${cdpPort}/json/version`); break; }
    catch { if (Date.now() > d2) throw new Error('Chrome yeniden açılmadı'); await sleep(500); }
  }
  // unpacked uzantı restart'ta kaybolur → yeniden yükle (aynı path → aynı ID)
  const v2 = await (await fetch(`http://localhost:${cdpPort}/json/version`)).json();
  const b2 = new Cdp(v2.webSocketDebuggerUrl);
  const loaded = await b2.call('Extensions.loadUnpacked', { path: process.env.RUU_DIST });
  await b2.call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
  await b2.call('Target.createTarget', { url: `chrome-extension://${loaded.id}/sidepanel.html` });
  const panel2 = await pageCdp('sidepanel.html');
  await sleep(2000); // offscreen boot + restoreStale

  const off2 = await pageCdp('offscreen.html');
  let restored = null;
  const dR = Date.now() + 15_000;
  while (Date.now() < dR) {
    await sleep(700);
    restored = JSON.parse(await evalIn(off2,
      `(()=>{const j=[...__ruu.jobs.values()].find(x=>x.url===${JSON.stringify(url)});` +
      `return JSON.stringify(j? {st:j.state, dl:(j.alloc?j.alloc.downloadedBytes():0), id:j.id} : null)})()`));
    if (restored && restored.st === 'paused') break;
  }

  let ok = false;
  let note = 'restore edilemedi';
  if (restored && restored.st === 'paused' && restored.dl > 0 && restored.dl < 80 * MB) {
    await evalIn(panel2,
      `chrome.runtime.sendMessage({target:'sw',type:'resume',jobId:${JSON.stringify(restored.id)}}); 'ok'`);
    const d3 = Date.now() + 90_000;
    let st = '';
    while (Date.now() < d3) {
      await sleep(1000);
      st = await evalIn(off2,
        `(()=>{const j=[...__ruu.jobs.values()].find(x=>x.id===${JSON.stringify(restored.id)});` +
        `return j? j.state : 'yok'})()`);
      if (st === 'done' || st === 'error') break;
    }
    let file = null;
    for (let i = 0; i < 20 && !file; i++) { await sleep(500); file = findFile(80 * MB); }
    const bad = file ? verifyPattern(file) : 'dosya yok';
    ok = st === 'done' && !bad;
    note = ok
      ? `kesinti anı ${Math.round(dlBefore / MB)}MB, restore ${Math.round(restored.dl / MB)}MB'den sürdü`
      : (bad ?? `state=${st}`);
  } else if (restored) {
    note = `restore durumu beklenmedik: ${restored.st} @${Math.round(restored.dl / MB)}MB`;
  }
  if (!ok && !restored) {
    // teşhis: OPFS'te ne var, jobs map'te ne var?
    const diag = await evalIn(off2,
      `(async()=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('jobs',{create:true});` +
      `const names=[]; for await (const n of dir.keys()) names.push(n);` +
      `return JSON.stringify({opfs:names, jobs:[...__ruu.jobs.values()].map(j=>({u:j.url.slice(-20),st:j.state}))})})()`);
    note = `restore edilemedi — diag: ${diag}`;
  }
  record('S5 crash-resume (tarayıcı restart)', ok, note);
  off2.close();
  panel2.close();
  b2.close();
}

const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} senaryo geçti`);
process.exit(fails ? 1 : 0);
