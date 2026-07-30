/**
 * Yeniden deneme eşiği (Nadir kararı 2026-07-30): varsayılan 1 retry;
 * kullanıcı ayarlardan artırabilir. Eşik iş-düzeyi ardışık hata sayacına uygulanır:
 * her bağlantı (ilk deneme + retry) hakkını kullanana kadar iş düşmez.
 */
export function failThreshold(connections: number, maxRetries: number): number {
  const conns = Math.max(1, connections);
  const retries = Math.max(0, maxRetries);
  return Math.max(2, conns * (1 + retries));
}
