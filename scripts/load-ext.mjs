/**
 * CDP Extensions.loadUnpacked ile unpacked uzantı yükler (Chrome 137+ 'da
 * --load-extension bayrağı kaldırıldığı için tek desteklenen yol).
 * Tarayıcı --enable-unsafe-extension-debugging ile açılmış olmalı.
 *
 * Kullanım: node scripts/load-ext.mjs [port] [distPath]
 */
const port = process.argv[2] ?? '9270';
const dist = process.argv[3] ?? new URL('../dist', import.meta.url).pathname;

const version = await (await fetch(`http://localhost:${port}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);

const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('CDP zaman aşımı')), 10000);
  ws.onopen = () => {
    ws.send(JSON.stringify({ id: 1, method: 'Extensions.loadUnpacked', params: { path: dist } }));
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id === 1) {
      clearTimeout(timer);
      resolve(msg);
    }
  };
  ws.onerror = (e) => { clearTimeout(timer); reject(new Error('WS hatası')); };
});
ws.close();

if (result.error) {
  console.error('YÜKLENEMEDİ:', JSON.stringify(result.error));
  process.exit(1);
}
console.log('EXTENSION_ID=' + result.result.id);
