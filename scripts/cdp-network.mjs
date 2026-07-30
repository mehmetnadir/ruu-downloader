/**
 * Bir CDP hedefinin Network olaylarını N saniye dinler (request/response/data/fail).
 * Kullanım: node scripts/cdp-network.mjs <port> <url-substring> [saniye]
 */
const [port, urlPart, secs = '5'] = process.argv.slice(2);

const targets = await (await fetch(`http://localhost:${port}/json`)).json();
const target = targets.find((t) => t.url.includes(urlPart));
if (!target) { console.error('hedef yok'); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const reqs = new Map();
ws.onopen = () => ws.send(JSON.stringify({ id: ++id, method: 'Network.enable', params: {} }));
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  const p = m.params;
  switch (m.method) {
    case 'Network.requestWillBeSent':
      reqs.set(p.requestId, p.request.url.slice(-40));
      console.log('SENT   ', p.requestId, p.request.url.slice(-40), JSON.stringify(p.request.headers.Range ?? ''));
      break;
    case 'Network.responseReceived':
      console.log('RESP   ', p.requestId, p.response.status, reqs.get(p.requestId) ?? '');
      break;
    case 'Network.dataReceived':
      console.log('DATA   ', p.requestId, p.dataLength);
      break;
    case 'Network.loadingFailed':
      console.log('FAILED ', p.requestId, p.errorText, p.blockedReason ?? '', reqs.get(p.requestId) ?? '');
      break;
    case 'Network.loadingFinished':
      console.log('FINISH ', p.requestId);
      break;
  }
};
setTimeout(() => process.exit(0), Number(secs) * 1000);
