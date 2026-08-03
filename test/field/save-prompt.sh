#!/usr/bin/env bash
# Chrome'un "Her dosya için kaydetme yerini sor" tercihine saygı duyuyor muyuz?
#
# İddia: downloads.download()'a `saveAs` GEÇMEDİĞİMİZ için kararı Chrome verir.
# Belgeler bunu açıkça yazmıyor (yalnızca true/false anlatılıyor), o yüzden
# ölçüyoruz: profile prompt_for_download=true yazılır, bir teslim tetiklenir,
# indirmenin "pencere bekliyor" durumunda takılıp takılmadığına bakılır.
#
# Kullanım: ./test/field/save-prompt.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
free_port() { node -e "const n=require('net');const s=n.createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})"; }
PORT=$(free_port); SRV=$(free_port); PROFILE=$(mktemp -d /tmp/ruu-prompt.XXXXXX)
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
cleanup() { kill "$SRV_PID" 2>/dev/null || true; pkill -9 -f "$PROFILE" 2>/dev/null || true; rm -rf "$PROFILE"; }
trap cleanup EXIT

npm run build >/dev/null
node test/server/server.mjs "$SRV" & SRV_PID=$!
sleep 1

# Tercihi profile yaz — Chrome'un "her dosya için sor" ayarı
mkdir -p "$PROFILE/Default"
cat > "$PROFILE/Default/Preferences" <<'JSON'
{"download":{"prompt_for_download":true,"directory_upgrade":true},"profile":{"exit_type":"Normal"}}
JSON

"$CHROME" --user-data-dir="$PROFILE" --remote-debugging-port="$PORT" \
  --enable-unsafe-extension-debugging --no-first-run --no-default-browser-check >/dev/null 2>&1 &
for i in $(seq 1 40); do curl -s -m 1 "http://localhost:$PORT/json/version" >/dev/null 2>&1 && break; sleep 0.5; done
EXT=$(node scripts/load-ext.mjs "$PORT" | sed -n 's/EXTENSION_ID=//p')
echo "uzantı: $EXT · prompt_for_download=true"

node - "$PORT" "$EXT" "$SRV" <<'JS'
const [port, extId, srv] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function cdp(ws, method, params) {
  const s = new WebSocket(ws);
  try {
    return await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('zaman aşımı')), 15000);
      s.onerror = (e) => { clearTimeout(t); rej(e); };
      s.onopen = () => s.send(JSON.stringify({ id: 1, method, params }));
      s.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === 1) { clearTimeout(t); res(m.result); } };
    });
  } finally { try { s.close(); } catch { /* kapalı */ } }
}
async function find(part) {
  for (let i = 0; i < 40; i++) {
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
await ev(panel, `chrome.runtime.sendMessage({target:'sw',type:'add',url:'http://localhost:${srv}/f/3'}); 'ok'`);
await sleep(9000);

// downloads.search: pencere beklenirken öğe ya hiç yaratılmaz ya da in_progress'te kalır
const items = await ev(panel,
  `chrome.downloads.search({}).then(d=>JSON.stringify(d.map(x=>({s:x.state,f:(x.filename||'').split('/').pop(),b:x.bytesReceived}))))`);
const off = await find('offscreen.html');
const job = await ev(off, `(()=>{const j=[...__ruu.jobs.values()][0]; return j? j.state : 'yok'})()`);
console.log('\nchrome.downloads kayıtları:', items);
console.log('motor iş durumu:', job);
console.log(job === 'done'
  ? '→ pencere ÇIKMADI, doğrudan kaydedildi (tercih dikkate ALINMIYOR olabilir)'
  : `→ iş '${job}' durumunda takılı: kaydetme penceresi AÇILDI, tercihe saygı duyuluyor`);
JS
