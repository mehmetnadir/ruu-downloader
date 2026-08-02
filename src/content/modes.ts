/**
 * Servis başına indirme modu (Nadir kararı 2026-08-02):
 *   'off'  → link tanınsa da hiçbir şey yapılmaz (düğme bile çıkmaz)
 *   'ask'  → mailde düğme çıkar, kullanıcı tıklayınca akış başlar (varsayılan)
 *   'auto' → TAM OTOMATİK: link görülür görülmez akış başlar, kullanıcı tıklamaz
 *
 * 'auto' bilinçli olarak OPT-IN'dir: kullanıcının istemediği dosyanın kendi
 * kendine inmesi kabul edilemez. Ayrıca 'auto' yalnızca kullanıcının AÇTIĞI
 * mailde, GÖRÜNÜR bir link için ve oturum başına bir kez tetiklenir.
 */
export type ServiceMode = 'off' | 'ask' | 'auto';

export const DEFAULT_MODE: ServiceMode = 'ask';

export function modeFor(
  serviceId: string,
  modes: Record<string, ServiceMode> | undefined,
  globalAuto: boolean,
): ServiceMode {
  const explicit = modes?.[serviceId];
  if (explicit) return explicit;
  return globalAuto ? 'auto' : DEFAULT_MODE;
}

/** Otomatik akış için tekilleştirme anahtarı — aynı link iki kez inmesin. */
export function autoKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`; // izleme parametreleri (utm, t_exp…) yok sayılır
  } catch {
    return url;
  }
}
