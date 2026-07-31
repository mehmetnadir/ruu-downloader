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
  | { action: 'skip'; reason: 'disabled' | 'scheme' | 'own' | 'small' | 'not-active'; url: string };

export function decideTakeover(
  item: TakeoverItem,
  settings: TakeoverSettings,
  isOwn: (url: string) => boolean,
): TakeoverDecision {
  const url = item.finalUrl || item.url;
  if (!settings.takeover) return { action: 'skip', reason: 'disabled', url };
  if (!/^https?:/i.test(url)) {
    // blob:/data: siteler tarafından üretilen tek-seferlik içerik — yeniden
    // fetch EDİLEMEZ, motor devralamaz; native kalması doğru davranış.
    return { action: 'skip', reason: 'scheme', url };
  }
  if (isOwn(url)) return { action: 'skip', reason: 'own', url };
  if (item.state !== 'in_progress') return { action: 'skip', reason: 'not-active', url };
  const size = item.totalBytes ?? -1;
  if (size > 0 && size < settings.takeoverMinMB * 1024 * 1024) {
    return { action: 'skip', reason: 'small', url };
  }
  return { action: 'take', url };
}
