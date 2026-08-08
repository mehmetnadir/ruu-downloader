#!/usr/bin/env bash
# Ayarlar sayfasının ekran görüntüsünü alır (görsel kontrol için).
# Kullanım: ./test/field/options-shot.sh [down]   → /tmp/ruu-options.png
#   down: yardımcı "açık ama ulaşılamıyor" durumunu tetikler (kurulum tarifi görünür)
set -euo pipefail
cd "$(dirname "$0")/../.."
STATE="${1:-off}"
free_port(){ node -e "const n=require('net');const s=n.createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})"; }
P=$(free_port); PROF=$(mktemp -d /tmp/ruu-shot.XXXXXX)
cleanup(){ pkill -9 -f "$PROF" 2>/dev/null || true; rm -rf "$PROF"; }
trap cleanup EXIT
npm run build >/dev/null
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --user-data-dir="$PROF" \
  --remote-debugging-port="$P" --enable-unsafe-extension-debugging \
  --no-first-run --window-size=1200,900 >/dev/null 2>&1 &
for i in $(seq 1 40); do curl -s -m 1 "http://localhost:$P/json/version" >/dev/null 2>&1 && break; sleep 0.5; done
EXT=$(node scripts/load-ext.mjs "$P" | sed -n 's/EXTENSION_ID=//p')
RUU_STATE="$STATE" node - "$P" "$EXT" <<'JS'
const [port, ext] = process.argv.slice(2);
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
async function cdp(ws){ const s=new WebSocket(ws); await new Promise(r=>s.onopen=r);
  let n=0; const wait=new Map();
  s.onmessage=(e)=>{const m=JSON.parse(e.data); if(wait.has(m.id)){wait.get(m.id)(m.result);wait.delete(m.id);}};
  return {call:(method,params)=>new Promise(res=>{const id=++n;wait.set(id,res);
    s.send(JSON.stringify({id,method,params}));}), close:()=>s.close()};
}
const ver = await (await fetch(`http://localhost:${port}/json/version`)).json();
const b = await cdp(ver.webSocketDebuggerUrl);
await b.call('Target.createTarget',{url:`chrome-extension://${ext}/options.html`});
await sleep(2500);
const ts = await (await fetch(`http://localhost:${port}/json`)).json();
const t = ts.find(x=>x.url.includes('options.html'));
const p = await cdp(t.webSocketDebuggerUrl);
const ev=(expr)=>p.call('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});
if (process.env.RUU_STATE === 'down') {
  await ev(`chrome.storage.local.set({useHelper:true})`);
  await ev(`chrome.runtime.sendMessage({target:'sw',type:'helper-query'}); 'ok'`);
  await sleep(3000);
}
const shot = await p.call('Page.captureScreenshot',{format:'png'});
const { writeFileSync } = await import('node:fs');
writeFileSync('/tmp/ruu-options.png', Buffer.from(shot.data,'base64'));
console.log('kaydedildi: /tmp/ruu-options.png');
p.close(); b.close();
JS
