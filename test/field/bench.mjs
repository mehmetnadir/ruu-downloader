/**
 * Saha hız ölçümü — "segmentli indirme gerçekten hızlandırıyor mu?"
 * Denetim bulgusu C1'e cevap: iddiayı ölçümle destekle ya da vazgeç.
 *
 * Yöntem: aynı dosya, aynı host, DÖNÜŞÜMLÜ (A/B/A/B) koşum — ağ dalgalanması
 * bir tarafa sistematik avantaj vermesin. Her ölçüm doğrudan HTTP Range ile
 * yapılır (Ruu'nun motorunun kullandığı mekanizmanın aynısı), böylece
 * tarayıcı/eklenti gürültüsü karışmaz.
 *
 * Kullanım: node test/field/bench.mjs <url> [tekrar]
 */
const [url, repeatArg] = process.argv.slice(2);
if (!url) {
  console.error('kullanım: node test/field/bench.mjs <doğrudan-dosya-url> [tekrar=3]');
  process.exit(2);
}
const REPEAT = Number(repeatArg ?? 3);
const CONNS = 6; // Chrome tavanı

async function head() {
  const r = await fetch(url, { headers: { Range: 'bytes=0-0' }, cache: 'no-store' });
  const cr = r.headers.get('content-range');
  r.body?.cancel().catch(() => undefined);
  const size = cr ? Number(cr.split('/')[1]) : Number(r.headers.get('content-length'));
  return { size, ranged: r.status === 206, proto: r.headers.get('x-firefox-spdy') ?? 'bilinmiyor' };
}

async function drain(res) {
  let n = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
  }
  return n;
}

async function single(size) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { Range: `bytes=0-${size - 1}` }, cache: 'no-store' });
  const n = await drain(res);
  return { ms: performance.now() - t0, bytes: n };
}

async function parallel(size, conns) {
  const per = Math.ceil(size / conns);
  const t0 = performance.now();
  const parts = await Promise.all(
    Array.from({ length: conns }, (_, i) => {
      const start = i * per;
      const end = Math.min(size, start + per) - 1;
      if (start > end) return Promise.resolve(0);
      return fetch(url, { headers: { Range: `bytes=${start}-${end}` }, cache: 'no-store' }).then(drain);
    }),
  );
  return { ms: performance.now() - t0, bytes: parts.reduce((a, b) => a + b, 0) };
}

const mbps = (bytes, ms) => (bytes / 1024 / 1024) / (ms / 1000);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const info = await head();
if (!info.ranged || !info.size) {
  console.log(`Range desteklenmiyor ya da boyut bilinmiyor — ölçüm anlamsız (${url})`);
  process.exit(0);
}
console.log(`host: ${new URL(url).hostname} · boyut: ${(info.size / 1048576).toFixed(1)} MB · ${REPEAT} tekrar\n`);

const singles = [];
const parallels = [];
for (let i = 0; i < REPEAT; i++) {
  // Dönüşümlü: A,B,B,A… sırası sistematik yanlılığı azaltır
  const order = i % 2 === 0 ? ['s', 'p'] : ['p', 's'];
  for (const which of order) {
    const r = which === 's' ? await single(info.size) : await parallel(info.size, CONNS);
    const speed = mbps(r.bytes, r.ms);
    (which === 's' ? singles : parallels).push(speed);
    console.log(`  ${which === 's' ? 'tek     ' : `${CONNS} paralel`}: ${speed.toFixed(2)} MB/s`);
  }
}

const s = median(singles);
const p = median(parallels);
console.log(`\nmedyan tek: ${s.toFixed(2)} MB/s · medyan ${CONNS} paralel: ${p.toFixed(2)} MB/s`);
console.log(`KAZANÇ: ×${(p / s).toFixed(2)}`);
