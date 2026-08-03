/**
 * Rampa doğrulaması: gerçek hostun hız EĞRİSİNİ (n=1..6) ölç, sonra
 * src/engine/ramp.ts'in bu eğri üzerinde nerede durduğunu göster.
 *
 * bench.mjs "6 paralel iyi mi?" sorusunu cevaplıyordu. Bu script
 * "rampamız DOĞRU sayıda bağlantıda mı duruyor?" sorusunu cevaplar.
 *
 * Kullanım: node test/field/ramp-curve.mjs <url> [maxN=6]
 */
const [url, maxArg] = process.argv.slice(2);
const MAXN = Number(maxArg ?? 6);
if (!url) { console.error('kullanım: node test/field/ramp-curve.mjs <url> [maxN]'); process.exit(2); }

async function size() {
  const r = await fetch(url, { headers: { Range: 'bytes=0-0' }, cache: 'no-store' });
  r.body?.cancel().catch(() => undefined);
  const cr = r.headers.get('content-range');
  return cr ? Number(cr.split('/')[1]) : 0;
}
async function drain(res) { let n = 0; const rd = res.body.getReader();
  for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.length; } return n; }
async function at(n, total) {
  const per = Math.ceil(total / n), t0 = performance.now();
  const parts = await Promise.all(Array.from({ length: n }, (_, i) => {
    const s = i * per, e = Math.min(total, s + per) - 1;
    if (s > e) return Promise.resolve(0);
    return fetch(url, { headers: { Range: `bytes=${s}-${e}` }, cache: 'no-store' }).then(drain);
  }));
  const bytes = parts.reduce((a, b) => a + b, 0);
  return (bytes / 1048576) / ((performance.now() - t0) / 1000);
}

const total = await size();
if (!total) { console.log('Range yok — atlanıyor'); process.exit(0); }
console.log(`host: ${new URL(url).hostname} · ${(total / 1048576).toFixed(1)} MB\n`);

const curve = {};
for (let n = 1; n <= MAXN; n++) {
  curve[n] = await at(n, total);
  console.log(`  n=${n}: ${curve[n].toFixed(2)} MB/s`);
}

// Rampa mantığı ÜRETİM KODUNDAN gelir — kopyalanmaz, yoksa sessizce ayrışır.
// (Node 24 TypeScript'i doğrudan çalıştırıyor.)
const { RAMP_START, shouldAddConnection, afterDecision } = await import('../../src/engine/ramp.ts');
let st = { ...RAMP_START };
const path = [];
for (let step = 0; step < 30 && !st.settled; step++) {
  const speed = st.active === 0 ? 0 : curve[st.active];
  const add = shouldAddConnection(st, speed, MAXN);
  st = afterDecision(st, speed, add);
  if (add) path.push(st.active);
}
const active = st.active;
const best = Object.entries(curve).sort((a, b) => b[1] - a[1])[0];
const chosen = curve[active];
console.log(`\nrampa yolu: ${path.join(' → ')} · DURDU: n=${active} (${chosen.toFixed(2)} MB/s)`);
console.log(`en iyi olası: n=${best[0]} (${Number(best[1]).toFixed(2)} MB/s)`);
console.log(`verim: %${((chosen / best[1]) * 100).toFixed(0)} · sabit-6'ya karşı: ×${(chosen / curve[MAXN]).toFixed(2)}`);
