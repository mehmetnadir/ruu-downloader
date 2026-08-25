/**
 * Native (tarayıcıya devredilen) indirme seçenekleri.
 *
 * SAHA HATASI (Nadir, 2026-08-24): "Kaydetme penceresinde adı yazmama rağmen
 * sunucudan geldiği gibi kaydediyor."
 *
 * KÖK NEDEN: Sunucu Range desteklemediğinde motor `native-fallback` diyor ve
 * SW `chrome.downloads.download({ url })` çağırıyordu — `filename` YOK. Oysa
 * kullanıcı adı çoktan seçmişti (devralma o adı `forcedName` olarak taşıyor).
 * Ad parametresi verilmeyince Chrome, sunucunun Content-Disposition başlığına
 * düşüyor: kullanıcının yazdığı ad sessizce çöpe gidiyordu. Aynı çağrıda
 * boyut da 0 kaydediliyordu — geçmişte "0 B" satırlarının sebebi budur.
 *
 * Bu modül saf: Chrome API'sine dokunmaz, yalnız hangi seçeneklerin hangi
 * sırayla deneneceğini söyler.
 */
import { sanitizeRelativePath, safeFallbackName } from './filename';

export interface NativeDownloadOptions {
  url: string;
  filename?: string;
  conflictAction?: 'uniquify';
  saveAs?: false;
}

/**
 * Denenecek seçenekler, sırayla. İlki reddedilirse (Chrome adı
 * `net::IsSafePortablePathComponent` ile doğrular) bir sonrakine geçilir;
 * SON eleman HER ZAMAN adsızdır — indirme adlandırma yüzünden asla düşmemeli.
 *
 * @param forcedName kullanıcının kaydetme penceresinde seçtiği İndirilenler-göreli
 *   yol. Yoksa karar Chrome'undur: "her dosya için sor" ayarı çalışsın diye
 *   `saveAs` BİLİNÇLİ olarak geçilmez.
 */
export function nativeDownloadAttempts(url: string, forcedName?: string): NativeDownloadOptions[] {
  if (!forcedName) return [{ url }];
  const clean = sanitizeRelativePath(forcedName, '');
  if (!clean) return [{ url }];
  // Kullanıcı adı bir kez seçti: teslimde pencere İKİNCİ kez açılmamalı.
  const chosen: NativeDownloadOptions = {
    url, filename: clean, conflictAction: 'uniquify', saveAs: false,
  };
  const ascii = safeFallbackName(clean);
  const attempts: NativeDownloadOptions[] = [chosen];
  if (ascii && ascii !== clean) {
    attempts.push({ url, filename: ascii, conflictAction: 'uniquify', saveAs: false });
  }
  attempts.push({ url }); // son çare: ad kaybolur ama dosya iner
  return attempts;
}

/**
 * Native indirmede kullanıcının adını DAYATMA — saf eşleme mantığı.
 *
 * E2E S21 BULGUSU: `downloads.download({ url, filename })` YETMİYOR. Chromium'un
 * `net::GenerateFileName` sırası önce Content-Disposition'a bakar; eklentinin
 * önerdiği ad ancak başlık boşsa devreye girer. Sunucu ad dayattığında
 * kullanıcının seçtiği ad sessizce eziliyor.
 *
 * Son sözü söyleyen tek kapı `chrome.downloads.onDeterminingFilename`. O olay
 * bize yalnız DownloadItem'ı verir; hangi indirmenin hangi ada ait olduğunu
 * adresten eşlemek zorundayız. Burası o eşlemenin saf çekirdeği.
 */
export interface NativeNameMark {
  name: string;
  /** İşaretin konduğu an (epoch ms). */
  at: number;
}

export type NativeNameMarks = Record<string, NativeNameMark>;

/**
 * İşaretler süreli: eşleşmeyen bir kayıt sonsuza kadar durup ilerideki
 * alakasız bir indirmeye yapışmamalı. 2 dk, "devral → probe → native indirme
 * başladı" zincirinin en yavaş hâlini rahatça karşılar.
 */
export const NATIVE_NAME_TTL_MS = 120_000;

export function pruneNativeNames(marks: NativeNameMarks, now: number): NativeNameMarks {
  const out: NativeNameMarks = {};
  for (const [url, mark] of Object.entries(marks)) {
    if (now - mark.at <= NATIVE_NAME_TTL_MS) out[url] = mark;
  }
  return out;
}

/**
 * Bu indirme bizim işaretlediğimiz mi?
 *
 * `finalUrl` de denenir: sunucu yönlendirdiyse DownloadItem son adresi taşır,
 * bizim işaretimiz ise istediğimiz ilk adrestedir.
 *
 * @returns `name` eşleşen ad (yoksa null) ve `rest` işaretin ÇIKARILMIŞ hâli —
 *   tek kullanımlık: aynı ad ikinci bir indirmeye yapışmamalı.
 */
export function pickNativeName(
  marks: NativeNameMarks,
  item: { url?: string; finalUrl?: string },
  now: number,
): { name: string | null; rest: NativeNameMarks } {
  const rest = pruneNativeNames(marks, now);
  for (const u of [item.url, item.finalUrl]) {
    if (!u || !(u in rest)) continue;
    const { [u]: hit, ...without } = rest;
    return { name: hit!.name, rest: without };
  }
  return { name: null, rest };
}
