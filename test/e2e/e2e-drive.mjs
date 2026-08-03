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

// S6: GİZLİ İNDİRME — dosya iner ama tarayıcı geçmişinde iz kalmaz (PRD-3 #7)
{
  const url = `http://localhost:${serverPort}/f/12?rate=30`;
  await evalIn(panel, `chrome.runtime.sendMessage({target:'sw',type:'add',url:${JSON.stringify(url)},priv:true}); 'sent'`);
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
  for (let i = 0; i < 20 && !file; i++) { await sleep(500); file = findFile(12 * MB); }
  const bad = file ? verifyPattern(file) : 'dosya yok';
  await sleep(1000); // erase işlemi tamamlansın
  const historyHit = await evalIn(panel,
    `chrome.downloads.search({}).then(items => items.some(i => i.totalBytes === ${12 * MB}))`);
  const ok = st === 'done' && !bad && historyHit === false;
  record('S6 gizli indirme (dosya var, iz yok)', ok,
    ok ? 'dosya indi, geçmiş temiz' : (bad ?? `state=${st}, geçmişte iz: ${historyHit}`));
}

// S7: LİNKİ YENİLE — imzalı URL süresi dolar, yeni link MEVCUT ilerlemeyle sürer (acı #1)
{
  const urlA = `http://localhost:${serverPort}/f/25?rate=20&key=exp1&failAfterReq=4`;
  const urlB = `http://localhost:${serverPort}/f/25?rate=20&key=fresh1`;
  await evalIn(panel, `chrome.runtime.sendMessage({target:'sw',type:'add',url:${JSON.stringify(urlA)}}); 'sent'`);
  const offscreen = await pageCdp('offscreen.html');
  // 4 istekten sonra 403 → iş error'a düşmeli
  let info = null;
  const d1 = Date.now() + 40_000;
  while (Date.now() < d1) {
    await sleep(700);
    info = JSON.parse(await evalIn(offscreen,
      `(()=>{const j=[...__ruu.jobs.values()].find(x=>x.url===${JSON.stringify(urlA)});` +
      `return JSON.stringify(j? {st:j.state, id:j.id, dl:(j.alloc?j.alloc.downloadedBytes():0)} : null)})()`));
    if (info && (info.st === 'error' || info.st === 'done')) break;
  }
  let ok = false;
  let note = `link-expiry state=${info?.st}`;
  if (info && info.st === 'error' && info.dl > 0) {
    const dlAtFail = info.dl;
    await evalIn(panel,
      `chrome.runtime.sendMessage({target:'sw',type:'renew',jobId:${JSON.stringify(info.id)},url:${JSON.stringify(urlB)}}); 'ok'`);
    const d2 = Date.now() + 40_000;
    let st = '';
    while (Date.now() < d2) {
      await sleep(700);
      st = await evalIn(offscreen,
        `(()=>{const j=[...__ruu.jobs.values()].find(x=>x.id===${JSON.stringify(info.id)});` +
        `return j? j.state : 'yok'})()`);
      if (st === 'done' || st === 'error') break;
    }
    let file = null;
    for (let i = 0; i < 20 && !file; i++) { await sleep(500); file = findFile(25 * MB); }
    const bad = file ? verifyPattern(file) : 'dosya yok';
    ok = st === 'done' && !bad;
    note = ok
      ? `403'te ${Math.round(dlAtFail / MB)}MB vardı, yeni linkle tamamlandı`
      : (bad ?? `renew sonrası state=${st}`);
  }
  offscreen.close();
  record('S7 süresi dolan link → yenile', ok, note);
}

// S8: PAYLAŞIM AKIŞI — sahte paylaşım sayfası: onay + indir otomatik tıklanır,
// başlayan indirmeyi devralma yakalar (mail entegrasyonunun çekirdeği)
{
  const shareUrl = `http://localhost:${serverPort}/share/18`;
  await evalIn(panel, `chrome.runtime.sendMessage({target:'sw',type:'share-fetch',url:${JSON.stringify(shareUrl)}}); 'sent'`);
  let file = null;
  const d1 = Date.now() + 60_000;
  while (Date.now() < d1 && !file) {
    await sleep(1000);
    file = findFile(18 * MB);
  }
  const bad = file ? verifyPattern(file) : 'dosya yok';
  let note = bad ?? 'onay+indir tıklandı, dosya bütün';
  if (bad) {
    const log = await evalIn(panel,
      `chrome.storage.local.get({takeoverLog:[]}).then(s=>JSON.stringify(s.takeoverLog.map(e=>e.action)))`);
    note = `${bad} — karar günlüğü: ${log}`;
  }
  record('S8 paylaşım sayfası otomasyonu', !bad, note);
}

// S9: SÜRESİ DOLMUŞ PAYLAŞIM — tıklamak yerine kullanıcı uyarılır, dosya inmez
{
  const url = `http://localhost:${serverPort}/share-expired`;
  await evalIn(panel, `chrome.storage.local.set({takeoverLog:[]}); chrome.runtime.sendMessage({target:'sw',type:'share-fetch',url:${JSON.stringify(url)}}); 'sent'`);
  let log = '[]';
  const dE = Date.now() + 30_000;
  while (Date.now() < dE) {
    await sleep(1000);
    log = await evalIn(panel,
      `chrome.storage.local.get({takeoverLog:[]}).then(s=>JSON.stringify(s.takeoverLog.map(e=>e.action)))`);
    if (log.includes('share-auto')) break; // yanlışlıkla tıkladıysa hemen bitir
  }
  const clickedWrongly = log.includes('share-auto');
  record('S9 süresi dolmuş link uyarısı', !clickedWrongly,
    clickedWrongly ? `expired sayfada tıklama yapıldı: ${log}` : 'tıklanmadı, uyarı yolu izlendi');
}

// S10: TAM OTOMATİK — servis 'auto' modda; mail açılır açılmaz kullanıcı hiçbir
// şeye tıklamadan indirme başlar ve dosya bütün iner
{
  await evalIn(panel, `chrome.storage.local.set({serviceModes:{test:'auto'}, takeoverLog:[]}); 'ok'`);
  await sleep(600);
  await browser.call('Target.createTarget', { url: `http://localhost:${serverPort}/mail/22` });
  let file = null;
  const dA = Date.now() + 70_000;
  while (Date.now() < dA && !file) {
    await sleep(1200);
    file = findFile(22 * MB);
  }
  const bad = file ? verifyPattern(file) : 'dosya yok';
  await evalIn(panel, `chrome.storage.local.set({serviceModes:{}}); 'ok'`); // temizle
  record('S10 tam otomatik (tıklama yok)', !bad, bad ?? 'mail açıldı, dosya kendi indi');
}

// S12: BÜTÜNLÜK — sunucu özet verirse doğrulanır; YANLIŞ özet işi DÜŞÜRÜR
{
  const okUrl = `http://localhost:${serverPort}/f/8?rate=30&digest=1`;
  const stOk = await addAndWait(okUrl, 'S12a', 40);
  const badUrl = `http://localhost:${serverPort}/f/9?rate=30&digest=bad`;
  const stBad = await addAndWait(badUrl, 'S12b', 40, 'error');
  const off = await pageCdp('offscreen.html');
  const okVerified = await evalIn(off,
    `(()=>{const j=[...__ruu.jobs.values()].find(x=>x.url===${JSON.stringify(okUrl)});` +
    `return j? String(j.digestOk) : 'yok'})()`);
  const badErr = await evalIn(off,
    `(()=>{const j=[...__ruu.jobs.values()].find(x=>x.url===${JSON.stringify(badUrl)});` +
    `return j? String(j.error) : 'yok'})()`);
  off.close();
  const pass = stOk === 'done' && okVerified === 'true' && stBad === 'error' && badErr === 'errDigest';
  record('S12 sunucu özeti doğrulama', pass,
    pass ? 'doğru özet ✓ doğrulandı, yanlış özet reddedildi'
         : `ok=${stOk}/${okVerified} bad=${stBad}/${badErr}`);
}

// S11: KALICI GEÇMİŞ — tamamlanan indirme storage'a yazılır, gizli olan YAZILMAZ
{
  const hist = JSON.parse(await evalIn(panel,
    `chrome.storage.local.get({history:[]}).then(s=>JSON.stringify(s.history))`));
  const names = hist.map((e) => e.name).join(',');
  // S1/S2/S3/S4 normal indirmeleri geçmişte olmalı; S6'nın gizli 12MB'ı OLMAMALI
  const hasNormal = hist.length > 0;
  const privLeaked = hist.some((e) => e.size === 12 * MB);
  record('S11 kalıcı geçmiş (gizli hariç)', hasNormal && !privLeaked,
    privLeaked ? 'GİZLİ İNDİRME GEÇMİŞE SIZDI' : `${hist.length} kayıt: ${names.slice(0, 60)}`);
}

// S15: DURAKLAT/DEVAM — duraklatılan iş kaldığı yerden devam edip TAMAMLANMALI.
// Denetim bulgusu 4: tamamlanma tespiti yalnızca onPumpExit'teydi; %100'e
// yakın duraklat/devam'da hiç pompa doğmayınca iş sonsuza kadar
// "indiriliyor · %100"da kilitleniyordu.
{
  const url = `http://localhost:${serverPort}/f/25?rate=8`;
  await evalIn(panel, `chrome.runtime.sendMessage({target:'sw',type:'add',url:${JSON.stringify(url)}}); 'sent'`);
  const off = await pageCdp('offscreen.html');
  const probe = `(()=>{const j=[...__ruu.jobs.values()].find(x=>x.url===${JSON.stringify(url)});
    if(!j) return null;
    return {s:j.state, d:j.alloc?.downloadedBytes?.()??0, n:j.size??0, id:j.id};})()`;

  // ilerlemenin bir kısmı insin, sonra duraklat
  let st = null;
  const d1 = Date.now() + 30_000;
  while (Date.now() < d1) {
    await sleep(500);
    st = await evalIn(off, probe);
    if (st && st.n && st.d / st.n > 0.3) break;
  }
  const pausedAt = st ? st.d : 0;
  await evalIn(panel,
    `chrome.runtime.sendMessage({target:'sw',type:'pause',jobId:${JSON.stringify(st?.id ?? '')}}); 'sent'`);
  await sleep(1500);
  const afterPause = await evalIn(off, probe);

  // devam ettir, tamamlanmasını bekle
  await evalIn(panel,
    `chrome.runtime.sendMessage({target:'sw',type:'resume',jobId:${JSON.stringify(st?.id ?? '')}}); 'sent'`);
  let final = null;
  const d2 = Date.now() + 60_000;
  while (Date.now() < d2) {
    await sleep(700);
    final = await evalIn(off, probe);
    if (final && (final.s === 'done' || final.s === 'error')) break;
  }
  off.close();
  const resumedFromScratch = afterPause && pausedAt > 0 && afterPause.d < pausedAt * 0.9;
  record('S15 duraklat/devam → tamamlanır',
    final?.s === 'done' && !resumedFromScratch,
    `duraklama=%${Math.round((pausedAt / (st?.n || 1)) * 100)} son=${final?.s} ` +
    (resumedFromScratch ? 'İLERLEME KAYBOLDU' : 'ilerleme korundu'));
}

// S16: KUYRUK — sınır 1 iken üç iş eklenir; ikisi BEKLEMELİ, sırayla inmeli.
// Kuyruk tamamen eklenti içinde çalışır: yerel yardımcı program gerekmez.
{
  await evalIn(panel, `chrome.storage.local.set({queueLimit:1}); 'set'`);
  await sleep(800); // ayar SW üzerinden motora itilsin
  const urls = [30, 31, 32].map((n) => `http://localhost:${serverPort}/f/5?q=${n}`);
  for (const u of urls) {
    await evalIn(panel, `chrome.runtime.sendMessage({target:'sw',type:'add',url:${JSON.stringify(u)}}); 'sent'`);
  }
  const off = await pageCdp('offscreen.html');
  const probe = `(()=>{const j=[...__ruu.jobs.values()];
    return ${JSON.stringify(urls)}.map(u=>{const x=j.find(y=>y.url===u);return x?x.state:'yok'}).join(',')})()`;

  // sınır ihlali gözlemlendi mi? (aynı anda 2+ çalışan)
  let violated = '';
  let states = '';
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await sleep(400);
    states = await evalIn(off, probe);
    const running = states.split(',')
      .filter((x) => x === 'probing' || x === 'downloading' || x === 'finalizing').length;
    if (running > 1 && !violated) violated = states;
    if (states.split(',').every((x) => x === 'done' || x === 'error')) break;
  }
  off.close();
  await evalIn(panel, `chrome.storage.local.set({queueLimit:0}); 'reset'`);
  record('S16 kuyruk sınırına uyar (limit=1)',
    states === 'done,done,done' && !violated,
    violated ? `SINIR İHLALİ: ${violated}` : `son=${states}`);
}

// S17: BOZUK DOSYA ADI — sunucu Chrome'un reddedeceği bir ad dayatır.
// SAHA HATASI (2026-08-03, sendgb): TESLİM.zip, 1,5 GB tamamlandı ama teslim
// "Invalid filename" ile düştü ve dosya kullanıcıya HİÇ ulaşmadı.
{
  // NFD Türkçe İ + görünmez LRM + Windows yasak karakteri, hepsi bir arada
  const evil = 'TESLI\u0307M\u200e:rapor .zip';
  const url = `http://localhost:${serverPort}/f/5?cd=${encodeURIComponent(evil)}`;
  await evalIn(panel, `chrome.runtime.sendMessage({target:'sw',type:'add',url:${JSON.stringify(url)}}); 'sent'`);
  const off = await pageCdp('offscreen.html');
  let st = '';
  let name = '';
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await sleep(700);
    const r = await evalIn(off,
      `(()=>{const j=[...__ruu.jobs.values()].find(x=>x.url===${JSON.stringify(url)});
        return j? j.state+'|'+j.filename : 'yok|'})()`);
    [st, name] = r.split('|');
    if (st === 'done' || st === 'error') break;
  }
  off.close();
  // Dosya gerçekten diske düşmüş mü? BOYUTA göre bakılır — CDP
  // setDownloadBehavior blob indirmelerini GUID adla kaydettiği için (bkz.
  // findFile yorumu) disk ADI bu koşumda doğrulanamaz; motorun ürettiği ad
  // doğrulanır, teslimin gerçekleştiği ise dosyanın varlığıyla kanıtlanır.
  const onDisk = findFile(5 * MB);
  const clean = !/[\u0000-\u001f\u200e:\\/]/.test(name)
    && name.normalize('NFC') === name
    && !/[\s.]+\.[^.]+$/.test(name); // gövde sonu boşluk yok
  record('S17 bozuk dosya adı → temizlenir ve teslim edilir',
    st === 'done' && clean && !!onDisk,
    `durum=${st} ad="${name}" diskte=${onDisk ? 'var' : 'YOK'}`);
}

// S13: HAYALET İNDİRME — probe uçarken iptal edilen iş DİRİLMEMELİ.
// Denetim bulgusu 2: probe abort edilmiyordu ve start() await'ten sonra
// kontrolsüz devam edip silinmiş dosyayı yeniden yaratıyordu.
{
  const url = `http://localhost:${serverPort}/f/8?probeDelay=3000`;
  await evalIn(panel, `chrome.runtime.sendMessage({target:'sw',type:'add',url:${JSON.stringify(url)}}); 'sent'`);
  const off = await pageCdp('offscreen.html');
  await sleep(600); // probe uçuyor, henüz cevap yok
  const jobId = await evalIn(off,
    `(()=>{const j=[...__ruu.jobs.values()].find(x=>x.url===${JSON.stringify(url)});return j?j.id:''})()`);
  await evalIn(panel, `chrome.runtime.sendMessage({target:'sw',type:'cancel',jobId:${JSON.stringify(jobId)}}); 'sent'`);
  // probe cevabı gelsin + diriliş için bol zaman tanı
  await sleep(5000);
  const ghost = await evalIn(off,
    `(()=>{const j=[...__ruu.jobs.values()].find(x=>x.url===${JSON.stringify(url)});
      return j? j.state : 'yok'})()`);
  // OPFS'te artık kalmamalı — hayalet iş dosyayı yeniden yaratıyordu
  const leftover = await evalIn(off,
    `(async()=>{const r=await navigator.storage.getDirectory();
      const d=await r.getDirectoryHandle('jobs',{create:true});
      const names=[]; for await (const n of d.keys()) names.push(n);
      return names.filter(n=>n.startsWith(${JSON.stringify(jobId)})).join(',')})()`);
  off.close();
  record('S13 probe sırasında iptal → hayalet yok', ghost === 'yok' && !leftover,
    `durum=${ghost} artık=${leftover || 'yok'}`);
}

// S14: EŞZAMANLI İKİ İNDİRME — ikisi de tamamlanmalı, hiçbiri sessizce düşmemeli.
//
// KAPSAM SINIRI (dürüst kayıt): bu senaryo offscreen belge ZATEN varken koşar,
// çünkü panel testi onu daha önce uyandırmış oluyor. Yani bulgu 1'in tam
// yarışını (offscreen YOKKEN iki eşzamanlı createDocument) tetiklemez —
// onun için SW'yi dışarıdan öldürmek gerekir ki CDP ile uzantı yüklüyken
// güvenilir değil. Burada kanıtlanan: eşzamanlı iki ekleme birbirini
// düşürmüyor. Yarışın kendisi kod incelemesiyle kapatıldı (in-flight promise
// memoizasyonu + "zaten var" hatasını başarı sayma).
{
  const a = `http://localhost:${serverPort}/f/6`;
  const b = `http://localhost:${serverPort}/f/7`;
  await evalIn(panel,
    `chrome.runtime.sendMessage({target:'sw',type:'add',url:${JSON.stringify(a)}});` +
    `chrome.runtime.sendMessage({target:'sw',type:'add',url:${JSON.stringify(b)}}); 'sent'`);
  const off = await pageCdp('offscreen.html');
  const deadline = Date.now() + 45_000;
  let states = '';
  while (Date.now() < deadline) {
    await sleep(700);
    states = await evalIn(off,
      `(()=>{const j=[...__ruu.jobs.values()];
        return [${JSON.stringify(a)},${JSON.stringify(b)}].map(u=>{
          const x=j.find(y=>y.url===u); return x?x.state:'yok'}).join(',')})()`);
    if (states.split(',').every((x) => x === 'done' || x === 'error')) break;
  }
  off.close();
  record('S14 eşzamanlı ekleme (offscreen yarışı)', states === 'done,done',
    `durumlar=${states}`);
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
