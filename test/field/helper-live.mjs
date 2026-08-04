/**
 * Yardımcı GERÇEKTEN devreye giriyor mu? Gerçek Go ikilisi, gerçek indirme.
 *
 * KAPSAM SINIRI (dürüst kayıt): `chrome.permissions.request()` modal bir
 * TARAYICI penceresi açar; sayfa içeriği olmadığı için CDP ile tıklanamaz.
 * Bu yüzden script izin akışını ve `connectNative` el sıkışmasını SÜRMEZ —
 * onlar elle doğrulanır. Sürdüğü şey asıl riskin olduğu yer:
 *   motorun shouldUseHelper kararı → HTTP istemcisi → GERÇEK ikili →
 *   dosyanın doğrudan indirme dizinine yazılması.
 * El sıkışma, SW'nin ürettiğinin birebir aynısı olan bir mesajla enjekte edilir.
 *
 * Kullanım: helper-live.sh çağırır.
 */
import { readdirSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';

const [port, extId, srv, dlDir, bin] = process.argv.slice(2);
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

// Yardımcıyı doğrudan başlat (Chrome'un native-messaging ile yapacağının aynısı)
const origin = `chrome-extension://${extId}`;
const proc = spawn(bin, ['-dir', dlDir, '-origin', origin], { stdio: ['ignore', 'pipe', 'inherit'] });
const line = await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('yardımcı açılmadı')), 10000);
  proc.stdout.on('data', (d) => { clearTimeout(t); res(String(d)); });
});
const m = line.match(/http:\/\/127\.0\.0\.1:(\d+) · token: (\w+)/);
if (!m) { console.error('yardımcı çıktısı okunamadı:', line); process.exit(1); }
const hs = { port: Number(m[1]), token: m[2], version: '1.0.0', dir: dlDir };
console.log(`── yardımcı çalışıyor: 127.0.0.1:${hs.port}`);

const ver = await (await fetch(`http://localhost:${port}/json/version`)).json();
await cdp(ver.webSocketDebuggerUrl, 'Target.createTarget', { url: `chrome-extension://${extId}/sidepanel.html` });
const panel = await find('sidepanel.html');
await sleep(2000);
await ev(panel, `chrome.storage.local.set({useHelper:true, continueAfterClose:true}); 'ok'`);

// Offscreen'i ÖNCE uyandır: ensureOffscreen SW tarafında el sıkışmayı bir kez
// dener (izin olmadığı için null) ve önbelleğe alır. Enjeksiyonumuz ondan sonra
// gelmeli, yoksa eziliyor.
await ev(panel, `chrome.runtime.sendMessage({target:'sw',type:'hello-panel'}); 'ok'`);
await sleep(2500);
const off = await find('offscreen.html');

// Önce ÇIPLAK fetch: başarısızsa nedenini yaz. Sessiz "null" hata ayıklanamaz.
const raw = await ev(off, `fetch('http://127.0.0.1:${hs.port}/health',{headers:{Authorization:'Bearer ${hs.token}'}})
  .then(r=>'HTTP '+r.status).catch(e=>'HATA: '+e.message)`);
console.log('offscreen → yardımcı çıplak fetch:', raw);

// El sıkışmayı PANELDEN gönder: chrome.runtime.sendMessage bir bağlamın kendi
// mesajını ona teslim etmez, offscreen kendi kendine yollayamaz.
await ev(panel, `chrome.runtime.sendMessage({target:'engine',type:'helper',handshake:${JSON.stringify(hs)}}); 'ok'`);
await sleep(1500);
const caps = await ev(off, `JSON.stringify(__ruu.helper())`);
console.log('motor yardımcıyı gördü mü:', caps);
console.log('motor ayarları:', await ev(off, `JSON.stringify(__ruu.helperOpts())`));
if (!caps || caps === 'null') { console.log('✗ yardımcıya bağlanılamadı'); proc.kill(); process.exit(1); }

// İşi DOĞRUDAN motora gönder, SW yönlendiricisini atlayarak.
// Neden: SW her 'add'de ensureOffscreen() → pushHelper() yapıyor ve izin
// olmadığı için el sıkışmayı null'a düşürüyor — bu DOĞRU ürün davranışı
// (yardımcı gerçekten erişilemez). Enjekte ettiğimiz el sıkışma da onunla
// birlikte siliniyor. Bu scriptin kapsamı zaten izin akışı değil, motor
// kararından sonraki zincir: karar → HTTP istemcisi → ikili → disk.
const url = `http://localhost:${srv}/f/12`;
await ev(panel, `chrome.runtime.sendMessage({target:'engine',type:'add',url:${JSON.stringify(url)}}); 'ok'`);

let st = '', via = false;
const deadline = Date.now() + 90_000;
while (Date.now() < deadline) {
  await sleep(1000);
  const r = String(await ev(off,
    `(()=>{const j=[...__ruu.jobs.values()].find(x=>x.url===${JSON.stringify(url)});
      return j? j.state+'|'+(j.viaHelper?'1':'0')+'|'+(j.helperError??'') : 'yok|0|'})()`));
  [st, via] = [r.split('|')[0], r.split('|')[1] === '1'];
  if (r.split('|')[2]) console.log('yardımcı hatası:', r.split('|')[2]);
  if (st === 'done' || st === 'error') break;
}

console.log('yardımcı kararları:', await ev(off, `JSON.stringify(__ruu.helperDecisions)`));
const files = readdirSync(dlDir).filter((f) => !f.endsWith('.ruupart'));
const sizes = files.map((f) => statSync(`${dlDir}/${f}`).size);
const want = 12 * 1024 * 1024;
console.log(`\ndurum=${st} · yardımcıyla=${via} · dosyalar=${files.join(',') || 'YOK'} (${sizes.join(',')})`);
const ok = st === 'done' && via && sizes.includes(want);
console.log(ok
  ? '✓ iş YARDIMCIYA devredildi, dosya doğrudan indirme dizinine yazıldı (OPFS/blob yok)'
  : `✗ beklenen: done + viaHelper + ${want} bayt`);
proc.kill();
process.exit(ok ? 0 : 1);
