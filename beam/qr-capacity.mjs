/**
 * Optik kanal kapasite hesaplayıcı — QR akışının teorik/pratik tavanını gösterir.
 * Amaç: "yoğunluğu artırsak ne olur?" sorusunu tahminle değil hesapla yanıtlamak.
 *
 * Kullanım: node beam/qr-capacity.mjs
 */

/** QR v40, ECC seviyesine göre ham veri kapasitesi (byte) — ISO/IEC 18004 */
const QR_V40 = { L: 2953, M: 2331, Q: 1663, H: 1273 };

/**
 * Kanal kapasitesi = kare kapasitesi × etkin kare hızı × başarı oranı
 * Kare kapasitesi, modül sayısı ve modül başına bit ile ölçeklenir.
 */
function throughput({
  qrBytes = QR_V40.L,   // tek siyah-beyaz QR karesi
  colorFactor = 1,       // renk katmanı (RGB kanal ayrımı ≈ 3×, ölçülmüş)
  levelFactor = 1,       // modül başına çok-seviyeli parlaklık (2 seviye=1×, 4=2×)
  fps = 30,              // etkin kare hızı (ekran Hz ve kamera fps'in küçüğü)
  decodeSuccess = 0.85,  // motion blur / pozlama kaynaklı kayıp sonrası oran
  fountainOverhead = 1.1, // fountain code ek yükü (~%10)
} = {}) {
  const perFrame = qrBytes * colorFactor * levelFactor;
  const bytesPerSec = (perFrame * fps * decodeSuccess) / fountainOverhead;
  return { bytesPerSec, mbps: (bytesPerSec * 8) / 1e6 };
}

const fmt = (r) => `${(r.bytesPerSec / 1024).toFixed(0).padStart(5)} KB/s  (${r.mbps.toFixed(2)} Mbps)`;
const gb = (r) => {
  const sec = (1024 ** 3) / r.bytesPerSec;
  return sec > 3600 ? `${(sec / 3600).toFixed(1)} saat` : `${(sec / 60).toFixed(0)} dk`;
};

const SCENARIOS = [
  ['Bugünkü tipik (mono, 30 fps, elde)', { fps: 30, decodeSuccess: 0.8 }],
  ['Sahada ölçülen rekor (mono, 60 fps, sabit)', { fps: 60, decodeSuccess: 0.9 }],
  ['+ Renk katmanı (RGB ≈ 3×)', { fps: 60, colorFactor: 3, decodeSuccess: 0.85 }],
  ['+ Renk + 120 Hz ekran/kamera', { fps: 120, colorFactor: 3, decodeSuccess: 0.8 }],
  ['+ Renk + 120 Hz + 4 seviye parlaklık', { fps: 120, colorFactor: 3, levelFactor: 2, decodeSuccess: 0.7 }],
  ['Laboratuvar tavanı (bozulma yok)', { fps: 120, colorFactor: 3, levelFactor: 2, decodeSuccess: 1 }],
];

console.log('OPTİK KANAL (ekran → kamera) KAPASİTE TAHMİNİ\n');
for (const [name, opts] of SCENARIOS) {
  const r = throughput(opts);
  console.log(`${name.padEnd(46)} ${fmt(r)}   1 GB → ${gb(r)}`);
}

console.log('\nKARŞILAŞTIRMA');
for (const [name, MBs] of [['WebRTC yerel ağ (tipik)', 12], ['WebRTC yerel ağ (iyi)', 60], ['USB-C kablo', 300]]) {
  const r = { bytesPerSec: MBs * 1024 * 1024, mbps: MBs * 8.389 };
  console.log(`${name.padEnd(46)} ${(MBs).toFixed(0).padStart(5)} MB/s  (${r.mbps.toFixed(0)} Mbps)   1 GB → ${gb(r)}`);
}

console.log(`
NOTLAR
- Renk (RGB kanal ayrımı) GERÇEK çarpandır: her modül 3 kat bit taşır.
  HCC2D ölçümü: 15.048 bit/inç² (renkli) vs 5.016 bit/inç² (mono) = 3×.
- QR'ın YÖNÜ çarpan DEĞİLDİR: 4 yön = log2(4) = 2 bit/kare.
  Kare zaten ~23.600 bit taşıyor → katkı %0,008. Çarpan değil, toplanan.
- Ekranı bölgelere ayırmak kapasiteyi ARTIRMAZ: toplam piksel alanı sabit,
  üstelik her parça kendi hizalama deseni için yer harcar. Kazancı hızda değil
  DAYANIKLILIKTA (kısmi kayıpta parça kurtarılır).
- Asıl duvar kameradır: her QR modülü için ≥2-3 kamera pikseli gerekir (Nyquist).
  1080p kamerayla ekranın 1000 px'lik alanı ~200-330 modül sınırı demektir;
  QR v40 zaten 177 modül — yani mevcut kodlar sınırın dibinde.
`);
