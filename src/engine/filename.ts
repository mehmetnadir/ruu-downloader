/**
 * Dosya adı temizleme — Chrome'un `downloads.download()` doğrulamasına uyar.
 *
 * NEDEN: pickFilename sunucunun Content-Disposition'ında yazanı AYNEN
 * geçiriyordu. Chrome ise adı `net::IsSafePortablePathComponent` ile katı
 * doğrular ve uymayanı "Invalid filename" ile REDDEDER. Sonuç saha hatası:
 * 1,5 GB'lık tamamlanmış bir indirme (`TESLİM.zip`, Türkçe İ) teslim
 * edilemedi — dosya diskte hazırdı ama kullanıcıya ulaşmadı.
 *
 * Chromium kuralları (base/i18n/file_util_icu.cc + net/base/filename_util.cc):
 *   - yasak karakter kümesi: [" * / : < > ? \ |] + [:Cc:] (kontrol) + [:Cf:] (biçim)
 *   - baştaki/sondaki boşluk ve sondaki nokta yasak (Windows)
 *   - "." ve ".." yasak
 *   - Windows ayrılmış adları (CON, PRN, AUX, NUL, COM1-9, LPT1-9) yasak
 *   - bileşen 255 karakteri aşamaz
 *
 * Ayrıca NFC normalizasyonu yapılır: Türkçe İ ayrışmış (NFD: I + U+0307)
 * gelirse hem panelde bozuk görünüyor hem de bazı yollarda ada boşluk
 * sızabiliyordu. NFC ikisini de kapatır.
 */

/**
 * Görünür yasak karakterler → alt çizgi ile DEĞİŞTİRİLİR.
 * (Silmek kelimeleri birbirine yapıştırır: "a:b" → "ab" okunaksız.)
 */
const ILLEGAL_VISIBLE = /["*/:<>?\\|]/g;

/**
 * Görünmez karakterler (kontrol + biçim) → SİLİNİR, alt çizgiye çevrilmez.
 * Bunlar zaten görünmüyor; "_" koymak kullanıcının yazmadığı bir işaret uydurur
 * ve BOM'lu bir adı "_dosya.zip" yapar.
 */
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g;

/** Windows'ta ayrılmış adlar — uzantıdan bağımsız olarak yasak. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

const MAX_LEN = 200; // 255 sınırının altında güvenli pay (uzantı + uniquify eki)

export function sanitizeFilename(raw: string, fallback = 'download'): string {
  // 1) NFC: ayrışmış İ/ş/ğ tek koda dönsün
  let name = raw.normalize('NFC');

  // 2) Yol ayırıcıları at — dosya adı asla dizin içermemeli
  name = name.split(/[/\\]/).pop() ?? '';

  // 3) Görünmezleri sil, görünür yasakları alt çizgiye çevir
  name = name.replace(INVISIBLE, '').replace(ILLEGAL_VISIBLE, '_');

  // 4) Baştaki/sondaki boşluk ve sondaki noktaları at (Windows reddeder)
  name = name.replace(/^[\s.]+/, '').replace(/[\s.]+$/, '');

  if (!name || name === '.' || name === '..') return fallback;

  // 5) Uzantıyı ayır — kısaltma yaparken uzantı korunmalı
  const dot = name.lastIndexOf('.');
  let stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';

  // 6) Gövde sonundaki boşluk/nokta: "rapor .zip" gibi adlar Windows'ta
  // sorun çıkarır (bileşen sonu boşluk). Chromium da bunları kırpar.
  stem = stem.replace(/[\s.]+$/, '');
  if (!stem) return fallback;

  // 7) Windows ayrılmış adı → başına alt çizgi
  if (RESERVED.test(stem)) stem = `_${stem}`;

  // 8) Uzunluk sınırı — uzantıyı koruyarak gövdeyi kırp
  if (stem.length + ext.length > MAX_LEN) {
    stem = stem.slice(0, Math.max(1, MAX_LEN - ext.length));
  }

  const out = `${stem}${ext}`.replace(/[\s.]+$/, '');
  return out || fallback;
}

/**
 * Son çare: temizlenmiş ad bile reddedilirse kullanılacak, kesinlikle güvenli ad.
 * Uzantı korunur (Chrome dosyayı doğru uygulamayla açsın), gövde ASCII'ye indirilir.
 */
/**
 * Türkçe harflerin ASCII karşılıkları.
 *
 * NFD ile yapılamaz: **ı (U+0131) ayrışmaz** — aksansız bir harftir, bir
 * "i"nin noktasız hâli değil. Bu projede aynı tuzağa daha önce düşülmüştü
 * (content/patterns.ts normalizeLabel). Açık eşleme tek doğru yol.
 */
const TR_ASCII: Record<string, string> = {
  ç: 'c', Ç: 'C', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I',
  ö: 'o', Ö: 'O', ş: 's', Ş: 'S', ü: 'u', Ü: 'U',
};

export function safeFallbackName(raw: string): string {
  const cleaned = sanitizeFilename(raw);
  const dot = cleaned.lastIndexOf('.');
  const ext = dot > 0 ? cleaned.slice(dot).replace(/[^.A-Za-z0-9]/g, '') : '';
  const stem = (dot > 0 ? cleaned.slice(0, dot) : cleaned)
    .replace(/[çÇğĞıİöÖşŞüÜ]/g, (c) => TR_ASCII[c] ?? c) // NFD ı'yı çözemez
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')    // kalan aksanları düşür
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/_+/g, '_').replace(/^_|_$/g, '');
  return `${stem || 'download'}${ext}`;
}
