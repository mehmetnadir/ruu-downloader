/**
 * Borç denetimi — yayın öncesi ve periyodik çalıştırılır.
 * Amaç: "sanırım tamamdır" yerine ölçülmüş bir borç listesi.
 *
 * Kullanım: node scripts/audit.mjs
 * Çıkış kodu: bulgu varsa 1 (CI'da gate olarak kullanılabilir)
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const findings = [];
const add = (sev, area, msg) => findings.push({ sev, area, msg });
const src = execSync('find src public/*.html -type f \\( -name "*.ts" -o -name "*.html" \\)')
  .toString().trim().split('\n');
const allCode = src.map((f) => readFileSync(f, 'utf8')).join('\n');

// 1) İzin kullanımı — kullanılmayan izin CWS reddi sebebi
const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'));
const PERM_MARKERS = {
  downloads: 'chrome.downloads.',
  'downloads.ui': 'setUiOptions',
  'downloads.open': 'downloads.open',
  storage: 'chrome.storage.',
  unlimitedStorage: 'navigator.storage',   // OPFS kotası
  sidePanel: 'chrome.sidePanel',
  offscreen: 'chrome.offscreen',
  notifications: 'chrome.notifications',
  power: 'chrome.power',
  scripting: 'chrome.scripting',
  alarms: 'chrome.alarms',
};
for (const perm of manifest.permissions) {
  const marker = PERM_MARKERS[perm];
  if (!marker) { add('WARN', 'izin', `${perm}: doğrulama işareti tanımlı değil`); continue; }
  if (!allCode.includes(marker)) add('HIGH', 'izin', `${perm} isteniyor ama kodda kullanılmıyor (CWS reddi riski)`);
}

// 2) i18n bütünlüğü — bir dilde eksik anahtar = o dilde ham anahtar görünür
const locales = readdirSync('public/_locales');
const keysets = Object.fromEntries(locales.map((l) => [
  l, new Set(Object.keys(JSON.parse(readFileSync(`public/_locales/${l}/messages.json`, 'utf8')))),
]));
const base = keysets['en'];
for (const [loc, keys] of Object.entries(keysets)) {
  const missing = [...base].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !base.has(k));
  if (missing.length) add('HIGH', 'i18n', `${loc}: ${missing.length} eksik anahtar (${missing.slice(0, 4).join(', ')})`);
  if (extra.length) add('WARN', 'i18n', `${loc}: en'de olmayan ${extra.length} anahtar`);
}

// 3) Kodda kullanılan ama hiçbir dilde tanımsız i18n anahtarı
const usedKeys = [...allCode.matchAll(/\bt\(['"]([a-zA-Z0-9_]+)['"]\)|data-i18n(?:-title|-ph)?="([a-zA-Z0-9_]+)"/g)]
  .map((m) => m[1] ?? m[2]).filter(Boolean);
for (const k of new Set(usedKeys)) {
  if (!base.has(k)) add('HIGH', 'i18n', `kodda kullanılan '${k}' anahtarı _locales/en'de YOK`);
}

// 4) Terk edilmiş işaretler
for (const f of src) {
  const body = readFileSync(f, 'utf8');
  for (const m of body.matchAll(/\b(TODO|FIXME|XXX|HACK)\b[:\s]?(.{0,60})/g)) {
    add('WARN', 'kod', `${f}: ${m[1]} ${m[2].trim()}`);
  }
}

// 5) Sessiz yutma (silent catch gate)
for (const f of src) {
  const body = readFileSync(f, 'utf8');
  // Yorum içermeyen boş catch blokları
  for (const m of body.matchAll(/catch\s*(?:\([^)]*\))?\s*\{\s*\}/g)) {
    add('HIGH', 'kod', `${f}: gerekçesiz boş catch — sessiz hata yutma`);
  }
}

// 6) Test kapsamı: motor dosyalarının unit testi var mı?
const engineFiles = src.filter((f) => f.startsWith('src/engine/') && f.endsWith('.ts'));
const testBodies = readdirSync('test').filter((f) => f.endsWith('.test.ts'))
  .map((f) => readFileSync(`test/${f}`, 'utf8')).join('\n');
for (const f of engineFiles) {
  const mod = f.split('/').pop().replace('.ts', '');
  if (mod.endsWith('.d')) continue;
  // Yalnız tip/sabit içeren dosyaların testi olmaz (çalışan mantık yok)
  const body = readFileSync(f, 'utf8');
  const hasLogic = /\b(function|=>)\s*[^;]*\{/.test(body.replace(/^\s*(export )?(interface|type)[\s\S]*?\n\}/gm, ''));
  if (!hasLogic) continue;
  if (!testBodies.includes(`engine/${mod}`)) add('WARN', 'test', `src/engine/${mod}.ts için unit test yok`);
}

// 7) Yayın paketi hijyeni
if (existsSync('out')) {
  const zips = readdirSync('out').filter((f) => f.endsWith('.zip'));
  for (const z of zips) {
    const list = execSync(`unzip -l out/${z}`).toString();
    if (list.includes('.map')) add('HIGH', 'paket', `${z}: sourcemap içeriyor`);
    const mf = execSync(`unzip -p out/${z} manifest.json`).toString();
    if (mf.includes('localhost')) add('HIGH', 'paket', `${z}: localhost eşleşmesi içeriyor`);
    if (JSON.parse(mf).name.includes('dev')) add('HIGH', 'paket', `${z}: adında 'dev' var`);
  }
}

// 8) Belge–kod tutarlılığı
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const readme = readFileSync('README.md', 'utf8');
const unitCount = (execSync('npx vitest run --reporter=dot 2>&1 || true').toString()
  .match(/Tests\s+(\d+)\s+passed/) ?? [])[1];
if (unitCount) {
  // Tek bir yeri kontrol etmek yetmiyordu: rozet eskimişken gövde metni güncel
  // olduğu için denetim "temiz" diyordu. Artık test sayısı İDDİA EDEN her yer
  // toplanır ve hepsi gerçekle eşleşmek zorunda.
  const claims = [
    ...readme.matchAll(/unit-(\d+)%20passing/g),
    ...readme.matchAll(/(\d+)\s+unit test/g),
    ...readme.matchAll(/(\d+)\s+birim test/g),
  ].map((m) => m[1]);
  if (claims.length === 0) {
    add('WARN', 'belge', 'README hiç unit test sayısı belirtmiyor');
  }
  for (const c of new Set(claims)) {
    if (c !== unitCount) {
      add('WARN', 'belge', `README'de eski test sayısı: ${c} (gerçek: ${unitCount})`);
    }
  }
}
const depCount = Object.keys(pkg.dependencies ?? {}).length;
if (readme.includes('zero dependencies') && depCount > 0) {
  add('HIGH', 'belge', `README 'zero dependencies' diyor ama ${depCount} bağımlılık var`);
}

// ── rapor ────────────────────────────────────────────────────────────────────
const order = { HIGH: 0, WARN: 1 };
findings.sort((a, b) => order[a.sev] - order[b.sev] || a.area.localeCompare(b.area));
if (findings.length === 0) {
  console.log('✓ borç bulunamadı');
} else {
  const high = findings.filter((f) => f.sev === 'HIGH').length;
  console.log(`${findings.length} bulgu (${high} yüksek)\n`);
  for (const f of findings) console.log(`  [${f.sev}] ${f.area.padEnd(6)} ${f.msg}`);
}
process.exit(findings.some((f) => f.sev === 'HIGH') ? 1 : 0);
