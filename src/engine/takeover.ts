/**
 * Devralma kararı — saf fonksiyon (SW onCreated bunu çağırır, panel teşhis
 * günlüğü gösterir). "Neden devralmadı?" sorusunun cevabı her zaman kayıtlı.
 */
export interface TakeoverItem {
  url: string;
  finalUrl?: string;
  state?: string;
  totalBytes?: number;
}

export interface TakeoverSettings {
  takeover: boolean;
  takeoverMinMB: number;
}

export type TakeoverDecision =
  | { action: 'take'; url: string }
  | { action: 'skip'; reason: 'disabled' | 'bypass' | 'scheme' | 'own' | 'small' | 'not-active'; url: string };

/**
 * @param forced Kullanıcı açıkça "Ruu ile indir" dedi (paylaşım akışı) —
 *   boyut eşiği UYGULANMAZ. 2,6 KB'lık bir WeTransfer dosyası da Ruu'ya gelir;
 *   aksi halde kullanıcı düğmeye bastığı halde Chrome indiriyor gibi görünür.
 * @param bypassed Kullanıcı bağlantıya Cmd/Ctrl/Alt basılı tıkladı — "bunu
 *   tarayıcı indirsin" demektir. `forced`'dan ÖNCE bakılır: ikisi de doğruysa
 *   kazanan tuş basılı tıklamadır, çünkü o AN verilmiş bir karardır.
 */
export function decideTakeover(
  item: TakeoverItem,
  settings: TakeoverSettings,
  isOwn: (url: string) => boolean,
  forced = false,
  bypassed = false,
): TakeoverDecision {
  const url = item.finalUrl || item.url;
  if (bypassed) return { action: 'skip', reason: 'bypass', url };
  if (!settings.takeover) return { action: 'skip', reason: 'disabled', url };
  if (!/^https?:/i.test(url)) {
    // blob:/data: siteler tarafından üretilen tek-seferlik içerik — yeniden
    // fetch EDİLEMEZ, motor devralamaz; native kalması doğru davranış.
    return { action: 'skip', reason: 'scheme', url };
  }
  if (isOwn(url)) return { action: 'skip', reason: 'own', url };
  if (item.state !== 'in_progress') return { action: 'skip', reason: 'not-active', url };
  const size = item.totalBytes ?? -1;
  if (!forced && size > 0 && size < settings.takeoverMinMB * 1024 * 1024) {
    return { action: 'skip', reason: 'small', url };
  }
  return { action: 'take', url };
}

/**
 * Devralma ön-uçuşu — "biz gerçekten indirebiliyor muyuz?"
 *
 * SAHA HATASI (Nadir, 2026-08-24, WeTransfer): kart "Takıldı · Kaydedilemedi —
 * SERVER_BAD_CONTENT · HTTP 404" gösteriyordu.
 *
 * KÖK NEDEN: sıra yanlıştı. Devralma, Chrome'un ÇALIŞAN indirmesini ÖNCE
 * iptal + erase ediyor, motor ancak ondan SONRA adrese kendi isteğini atıyordu.
 * WeTransfer'in imzalı indirme adresi yeniden istenebilir değil (tek kullanımlık
 * / oturuma bağlı): bizim isteğimiz 404 alıyor, native'e düşülüyor, Chrome da
 * aynı adrese yeniden gidip SERVER_BAD_CONTENT alıyordu. Sonuç: kullanıcının
 * ÇALIŞAN indirmesi bizim yüzümüzden ölüyordu.
 *
 * KURAL: çalışan bir indirmeyi, yerine geçebileceğini KANITLAMADAN yıkma.
 * Ön-uçuş bu kanıttır ve iptalden ÖNCE yapılır.
 */
export type PreflightVerdict =
  /** 206 — Range var, tam hız devralma. */
  | 'range'
  /** 200 — sunucu çalışıyor ama bölünemiyor; adres yeniden istenebilir,
   *  devralıp native'e düşmek güvenli (kart ve kullanıcı adı korunur). */
  | 'plain'
  /** Adres BİZE açılmıyor — Chrome'un indirmesine DOKUNMA. */
  | 'abort';

export function preflightVerdict(status: number): PreflightVerdict {
  if (status === 206) return 'range';
  if (status === 200) return 'plain';
  return 'abort';
}
