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

// 7b) Kritik dosyalarda test kapsamı boşluğu
// Bağımsız denetim (2026-08-03) bunu yakaladı: kapsam kontrolü yalnızca
// src/engine/ için yapılıyordu, oysa projedeki en karmaşık iki dosya
// (offscreen/engine.ts durum makinesi ve sw.ts yönlendirici) görüş alanı
// dışındaydı — 8 bulgunun 6'sı tam oradaydı.
{
  const critical = ['src/offscreen/engine.ts', 'src/sw.ts'];
  const e2eBody = existsSync('test/e2e/e2e-drive.mjs')
    ? readFileSync('test/e2e/e2e-drive.mjs', 'utf8') : '';
  // Bu dosyalar chrome/Worker'a bağlı olduğu için unit test yerine E2E ile
  // korunur. En azından yıkıcı yolların senaryosu OLMALI.
  const mustCover = [
    ['iptal', /type:'cancel'|type:"cancel"/],
    ['duraklat/devam', /type:'pause'|type:"pause"/],
    ['eşzamanlı indirme', /S14|eşzamanlı/i],
    ['çökme sonrası devam', /S5|crash/i],
  ];
  for (const [ad, re] of mustCover) {
    if (!re.test(e2eBody)) {
      add('WARN', 'test', `E2E'de "${ad}" senaryosu yok — ${critical.join(', ')} korumasız`);
    }
  }
}

// 7c) Bağlanmamış modül: tam yazılmış, tam test edilmiş, HİÇBİR YERDEN çağrılmayan.
// Denetleyicinin kör noktasıydı — "yeşil testler" bir modülün ürüne bağlı
// olduğunu KANITLAMAZ. Yarım kalmış entegrasyon, bitmiş gibi görünür.
{
  const srcFiles = execSync("find src -name '*.ts' -not -name '*.d.ts'")
    .toString().trim().split('\n').filter(Boolean);
  // Giriş noktalarını TAHMİN ETME — build yapılandırmasından oku, yoksa
  // yeni bir bundle eklendiğinde denetim yanlış alarm verir.
  const entryPoints = new Set(
    [...readFileSync('scripts/build.mjs', 'utf8').matchAll(/['"]([^'"]*src\/[^'"]+\.ts)['"]/g)]
      .map((m) => m[1].replace(/^\.\//, '')),
  );

  for (const f of srcFiles) {
    const mod = f.replace(/^src\//, '').replace(/\.ts$/, '');
    const base = mod.split('/').pop();
    if (base === 'types') continue;                            // yalnız tip bildirimi
    if (entryPoints.has(f)) continue;                          // bundle girişi — import edilmemesi normal
    // Kendisi dışında bir dosya bu modülü import ediyor mu?
    const importers = srcFiles.filter((o) => o !== f
      && new RegExp(`from ['"][^'"]*${base}['"]`).test(readFileSync(o, 'utf8')));
    if (importers.length === 0) {
      add('WARN', 'ölü-kod', `src/${mod}.ts hiçbir kaynak dosyadan import edilmiyor — entegrasyon yarım kalmış olabilir`);
    }
  }
}

// 7d) Motor ayarları: pushEngineSettings'in gönderdiği her alan ENGINE_SETTINGS
// listesinde OLMAK ZORUNDA, yoksa ayar değişse de motora hiç ulaşmaz (sessiz
// etkisizlik — kuyruk sınırında bu bir kez yaşandı).
{
  const sw = readFileSync('src/sw.ts', 'utf8');
  const listed = (sw.match(/const ENGINE_SETTINGS = \[([^\]]*)\]/) ?? [])[1] ?? '';
  const pushed = (sw.match(/type: 'settings',([\s\S]*?)\}\s*satisfies Msg/) ?? [])[1] ?? '';
  for (const m of pushed.matchAll(/(\w+):\s*settings\.(\w+)/g)) {
    if (!listed.includes(`'${m[2]}'`)) {
      add('HIGH', 'ayar', `'${m[2]}' motora gönderiliyor ama ENGINE_SETTINGS'te yok — değişince itilmez`);
    }
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

// Aynı sınıf hata E2E rozetinde de iki kez kaçtı: gövde metni güncellenirken
// rozet unutuluyor. Senaryo sayısını da doğrula.
if (existsSync('test/e2e/e2e-drive.mjs')) {
  const n = String((readFileSync('test/e2e/e2e-drive.mjs', 'utf8')
    .match(/\brecord\(/g) ?? []).length);
  const claims = [
    ...readme.matchAll(/E2E-(\d+)%20scenarios/g),
    ...readme.matchAll(/(\d+)\s*\/\s*\d+\s+E2E/g),
    ...readme.matchAll(/(\d+)\s+E2E scenario/g),
  ].map((m) => m[1]);
  for (const c of new Set(claims)) {
    if (c !== n) add('WARN', 'belge', `README'de eski E2E senaryo sayısı: ${c} (gerçek: ${n})`);
  }
}
const depCount = Object.keys(pkg.dependencies ?? {}).length;
if (readme.includes('zero dependencies') && depCount > 0) {
  add('HIGH', 'belge', `README 'zero dependencies' diyor ama ${depCount} bağımlılık var`);
}

// ── rapor ────────────────────────────────────────────────────────────────────
const order = { HIGH: 0, WARN: 1 };
findings.sort((a, b) => order[a.sev] - order[b.sev] || a.area.localeCompare(b.area));

// 9) Gizlilik beyanı ↔ manifest izinleri
// Beyan edilmemiş izin = mağaza incelemesinde "açıklanmamış davranış".
if (existsSync('PRIVACY.md')) {
  const priv = readFileSync('PRIVACY.md', 'utf8');
  const mf = JSON.parse(readFileSync('public/manifest.json', 'utf8'));
  // optional_permissions de beyan edilmeli: kullanıcı çalışma anında onay
  // verirken ne verdiğini bilmeli, ve incelemeci de aynı listeye bakıyor.
  for (const perm of [...(mf.permissions ?? []), ...(mf.optional_permissions ?? [])]) {
    if (!priv.includes(`\`${perm}\``)) {
      add('HIGH', 'gizlilik', `PRIVACY.md '${perm}' iznini açıklamıyor`);
    }
  }
  for (const cs of mf.content_scripts ?? []) {
    for (const m of cs.matches ?? []) {
      const host = (m.match(/:\/\/([^/]+)/) ?? [])[1]?.replace(/^\*\./, '') ?? '';
      if (!host || /localhost|127\.0\.0\.1/.test(host)) continue;
      const stem = host.split('.')[0].replace(/\*/g, '');
      if (stem && !priv.toLowerCase().includes(stem.toLowerCase())) {
        add('HIGH', 'gizlilik', `PRIVACY.md '${host}' content script'ini açıklamıyor`);
      }
    }
  }
}

if (findings.length === 0) {
  console.log('✓ borç bulunamadı');
} else {
  const high = findings.filter((f) => f.sev === 'HIGH').length;
  console.log(`${findings.length} bulgu (${high} yüksek)\n`);
  for (const f of findings) console.log(`  [${f.sev}] ${f.area.padEnd(6)} ${f.msg}`);
}
process.exit(findings.some((f) => f.sev === 'HIGH') ? 1 : 0);