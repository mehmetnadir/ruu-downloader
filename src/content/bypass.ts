/**
 * Tuş basılı tıklama dedektörü — "bu bağlantıyı tarayıcı indirsin".
 *
 * NEDEN İÇERİK BETİĞİ: `chrome.downloads.onCreated` klavye durumunu taşımaz.
 * Cmd/Ctrl/Alt basılı olduğunu yalnız sayfa bağlamı görebilir.
 *
 * BU BETİK MÜMKÜN OLAN EN KÜÇÜĞÜ OLMALI. Her http(s) sayfasına giriyor:
 * DOM okumaz, ağa çıkmaz, veri toplamaz, sayfayı değiştirmez. Yaptığı tek şey
 * tıklanan bağlantının adresini SW'ye bildirmektir. Ayar kapalıysa SW betiği
 * hiç kaydetmez (dinamik registerContentScripts).
 */
import { isBypassClick } from '../engine/bypass';

// Yakalama fazında dinliyoruz: sayfa kendi handler'ında `stopPropagation`
// çağırıp indirmeyi JS ile başlatsa bile tuş bilgisini kaçırmayalım.
// `mousedown`, `click`ten önce gelir — sayfa `click`i yutsa da biz görürüz.
addEventListener('mousedown', (e: MouseEvent) => {
  if (!isBypassClick(e)) return;
  const el = e.target as Element | null;
  const a = el?.closest?.('a[href], area[href]') as HTMLAnchorElement | null;
  const url = a?.href;
  if (!url || !/^https?:/i.test(url)) return;
  // Yanıt beklemiyoruz; SW uykudaysa Chrome onu uyandırır.
  chrome.runtime.sendMessage({ target: 'sw', type: 'bypass-click', url })
    .catch(() => undefined);
}, { capture: true, passive: true });
