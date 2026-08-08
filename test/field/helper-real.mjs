/**
 * Gerçek zincir doğrulaması — enjeksiyon YOK:
 *   ayar aç → SW connectNative → Chrome GERÇEK kurulu ikiliyi başlatır →
 *   el sıkışma NM kanalından → motor devreder → dosya GERÇEK ~/Downloads'a.
 */
import { existsSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [port, extId, srv] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdp(ws, method, params) {
  const s = new WebSocket(ws);
  try {
    return await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('CDP zaman aşımı')), 20000);
      s.onerror = (e) => { clearTimeout(t); rej(e); };
      s.onopen = () => s.send(JSON.stringify({ id: 1, method, params }));
      s.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === 1) { clearTimeout(t); res(m.result); } };
    });
  } finally { try { s.close(); } catch { /* kapalı */ } }
}
async function find(part, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const ts = await (await fetch(`http://localhost:${port}/json`)).json();
    const t = ts.find((x) => x.url.includes(part) && x.webSocketDebuggerUrl);
    if (t) return t.webSocketDebuggerUrl;
    await sleep(500);
  }
  throw new Error('hedef yok: ' + part);
}
const ev = async (ws, expr) =>
  (await cdp(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }))?.result?.value;

const ver = await (await fetch(`http://localhost:${port}/json/version`)).json();
await cdp(ver.webSocketDebuggerUrl, 'Target.createTarget', { url: `chrome-extension://${extId}/sidepanel.html` });
const panel = await find('sidepanel.html');
await sleep(2000);

// Ayarı aç — izin ZORUNLU olduğu için pencere çıkmaz; SW gerçek connectNative yapar
await ev(panel, `chrome.storage.local.set({useHelper:true, continueAfterClose:true}); 'ok'`);
await sleep(300);
await ev(panel, `chrome.runtime.sendMessage({target:'sw',type:'helper-query'}); 'ok'`);
await sleep(4000);

// TEŞHİS: connectNative'i panelden ÇIPLAK dene — hangi halka kopuk görelim
const probe = await ev(panel, `new Promise((res) => {
  let port;
  try { port = chrome.runtime.connectNative('com.ruu.downloader.helper'); }
  catch (e) { res('connect-throw: ' + e.message); return; }
  const t = setTimeout(() => res('zaman aşımı (mesaj yok)'), 5000);
  port.onMessage.addListener((m) => { clearTimeout(t); res('MESAJ: ' + JSON.stringify(m).slice(0,120)); });
  port.onDisconnect.addListener(() => {
    clearTimeout(t);
    res('disconnect: ' + (chrome.runtime.lastError?.message ?? 'sebepsiz'));
  });
})`);
console.log('── çıplak connectNative:', probe);

const off = await find('offscreen.html');
const caps = await ev(off, `JSON.stringify(__ruu.helper())`);
console.log('── motor, NM el sıkışmasıyla yardımcıyı gördü mü:', caps);
if (!caps || caps === 'null') {
  console.log('✗ connectNative zinciri KOPUK');
  process.exit(1);
}

const url = `http://localhost:${srv}/f/9`;
await ev(panel, `chrome.runtime.sendMessage({target:'engine',type:'add',url:${JSON.stringify(url)}}); 'ok'`);

let st = '', via = false;
const deadline = Date.now() + 90_000;
while (Date.now() < deadline) {
  await sleep(1000);
  const r = String(await ev(off,
    `(()=>{const j=[...__ruu.jobs.values()].find(x=>x.url===${JSON.stringify(url)});
      return j? j.state+'|'+(j.viaHelper?'1':'0')+'|'+(j.helperError??'') : 'yok|0|'})()`));
  const parts = r.split('|');
  st = parts[0]; via = parts[1] === '1';
  if (parts[2]) console.log('yardımcı hatası:', parts[2]);
  if (st === 'done' || st === 'error') break;
}

const target = join(homedir(), 'Downloads', 'test-9mb.bin');
const onDisk = existsSync(target) ? statSync(target).size : 0;
console.log(`\ndurum=${st} · yardımcıyla=${via} · ~/Downloads/test-9mb.bin=${onDisk} bayt`);
const ok = st === 'done' && via && onDisk === 9 * 1024 * 1024;
if (ok) {
  unlinkSync(target); // kanıt alındı — kullanıcının Downloads'ını kirletme
  console.log('✓ GERÇEK ZİNCİR ÇALIŞIYOR: connectNative → kurulu ikili → devir → ~/Downloads (test dosyası silindi)');
} else {
  console.log('✗ zincir kopuk — yukarıdaki durum satırlarına bak');
}
process.exit(ok ? 0 : 1);
