/**
 * CANLI rampa doğrulaması — saf fonksiyon değil, GERÇEK motor.
 *
 * ramp-curve.mjs karar mantığının doğruluğunu gösteriyor; bu script mantığın
 * ÜRETİM YOLUNDA (offscreen engine → spawnPumps → gerçek soketler) gerçekten
 * çalıştığını gösterir. İkisi ayrı sorular: saf fonksiyon doğru olup motora
 * yanlış bağlanmış olabilir.
 *
 * Her sorgu için kısa ömürlü CDP bağlantısı kullanılır (cdp-eval.mjs kalıbı) —
 * kalıcı soket denendi ve sessizce asıldı.
 *
 * Kullanım: node test/field/ramp-live.mjs <cdpPort> <extId> <url>
 */
const [port, extId, url] = process.argv.slice(2);
if (!url) { console.error('kullanım: ramp-live.mjs <cdpPort> <extId> <url>'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdp(wsUrl, method, params) {
  const ws = new WebSocket(wsUrl);
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP zaman aşımı')), 15000);
      ws.onerror = (e) => { clearTimeout(timer); reject(e); };
      ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }));
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id !== 1) return;
        clearTimeout(timer);
        resolve(m.result);
      };
    });
  } finally { try { ws.close(); } catch { /* kapanmışsa sorun değil */ } }
}

async function findTarget(urlPart, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const ts = await (await fetch(`http://localhost:${port}/json`)).json();
    const t = ts.find((x) => x.url.includes(urlPart) && x.webSocketDebuggerUrl);
    if (t) return t.webSocketDebuggerUrl;
    await sleep(500);
  }
  throw new Error(`hedef bulunamadı: ${urlPart}`);
}

const evalIn = async (wsUrl, expression) =>
  (await cdp(wsUrl, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))
    ?.result?.value;

// Panel sekmesini biz açmalıyız — yoksa SW/offscreen hiç uyanmaz.
const ver = await (await fetch(`http://localhost:${port}/json/version`)).json();
await cdp(ver.webSocketDebuggerUrl, 'Target.createTarget',
  { url: `chrome-extension://${extId}/sidepanel.html` });

const panel = await findTarget('sidepanel.html');
await sleep(2000);
await evalIn(panel, `chrome.runtime.sendMessage({target:'sw',type:'add',url:${JSON.stringify(url)}}); 'ok'`);

const off = await findTarget('offscreen.html');
const probe = `(()=>{const j=[...(globalThis.__ruu?.jobs?.values()??[])].find(x=>x.url===${JSON.stringify(url)});
  if(!j) return null;
  return {state:j.state, pumps:j.pumps, active:j.ramp?.active, settled:j.ramp?.settled,
          bestN:j.ramp?.bestN, kb:Math.round((j.ramp?.bestSpeed??0)/1024),
          done:j.alloc?.downloadedBytes?.() ?? 0, size:j.size ?? 0};})()`;

console.log('t(s)  durum        pompa  rampa  yerleşti  enİyiN  enİyi(KB/s)  ilerleme');
const seen = [];
for (let t = 0; t < 120; t++) {
  await sleep(1000);
  let s = null;
  try { s = await evalIn(off, probe); } catch { /* offscreen yeniden yükleniyor olabilir */ }
  if (!s) continue;
  seen.push(s.active);
  const pct = s.size ? `${Math.round((s.done / s.size) * 100)}%` : '—';
  console.log(
    `${String(t).padStart(3)}   ${String(s.state).padEnd(12)} ${String(s.pumps).padStart(4)} ` +
    `${String(s.active).padStart(6)} ${String(s.settled).padStart(9)} ${String(s.bestN).padStart(7)} ` +
    `${String(s.kb).padStart(12)} ${pct.padStart(9)}`);
  if (s.state === 'done' || s.state === 'error') break;
}
const peak = Math.max(...seen, 0);
console.log(`\ntepe: ${peak} bağlantı · gözlenen yol: ${[...new Set(seen)].join(' → ')}`);
console.log(peak > 1
  ? '✓ rampa ÜRETİM yolunda yükseldi — saf fonksiyon motora doğru bağlanmış'
  : '✗ rampa hiç yükselmedi — motor bağlantısını incele');
