/**
 * Bir CDP hedefinde (URL alt-dizgisiyle seçilir) JS ifadesi çalıştırır.
 * Kullanım: node scripts/cdp-eval.mjs <port> <url-substring> <expression>
 */
const [port, urlPart, expr] = process.argv.slice(2);

const targets = await (await fetch(`http://localhost:${port}/json`)).json();
const target = targets.find((t) => t.url.includes(urlPart));
if (!target) {
  console.error('hedef yok:', urlPart);
  console.error(targets.map((t) => `${t.type} ${t.url}`).join('\n'));
  process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('zaman aşımı')), 10000);
  ws.onopen = () => {
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: expr, awaitPromise: true, returnByValue: true },
    }));
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id === 1) { clearTimeout(timer); resolve(msg); }
  };
  ws.onerror = () => { clearTimeout(timer); reject(new Error('WS hatası')); };
});
ws.close();
console.log(JSON.stringify(result.result ?? result.error, null, 2));
