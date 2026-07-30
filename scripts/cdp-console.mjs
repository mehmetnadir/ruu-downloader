/**
 * Bir CDP hedefinin console + exception olaylarını N saniye dinler.
 * Kullanım: node scripts/cdp-console.mjs <port> <url-substring> [saniye]
 */
const [port, urlPart, secs = '4'] = process.argv.slice(2);

const targets = await (await fetch(`http://localhost:${port}/json`)).json();
const target = targets.find((t) => t.url.includes(urlPart));
if (!target) {
  console.error('hedef yok:', urlPart);
  process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));

ws.onopen = () => {
  send('Runtime.enable');
  send('Log.enable');
};
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === 'Runtime.consoleAPICalled') {
    const args = msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
    console.log(`[console.${msg.params.type}]`, args);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    console.log('[EXCEPTION]', d.text, d.exception?.description ?? '');
  } else if (msg.method === 'Log.entryAdded') {
    console.log(`[log.${msg.params.entry.level}]`, msg.params.entry.text);
  }
};

setTimeout(() => { ws.close(); process.exit(0); }, Number(secs) * 1000);
