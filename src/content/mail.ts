/**
 * Mail content script — SADECE Gmail/Outlook'ta çalışır (manifest matches).
 * Tanınan paylaşım linklerinin yanına minik Ruu butonu ekler; tıklanınca
 * SW 'share-fetch' ile çözümlemeyi üstlenir. DOM'a müdahale minimal ve geri
 * alınabilir; sayfa verisi OKUNMAZ, yalnızca link href'leri eşlenir.
 */
import { matchShareLink } from './patterns';

const MARK = 'data-ruu-btn';
const BTN_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
  'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/></svg>';

const label = chrome.i18n.getMessage('ruuBtn') || 'Ruu';

function inject(a: HTMLAnchorElement): void {
  const match = matchShareLink(a.href);
  if (!match) return;
  a.setAttribute(MARK, '1');
  const btn = document.createElement('button');
  btn.setAttribute('type', 'button');
  btn.setAttribute('title', label);
  btn.setAttribute('aria-label', label);
  btn.innerHTML = BTN_SVG;
  btn.style.cssText =
    'display:inline-flex;align-items:center;justify-content:center;' +
    'width:22px;height:22px;margin:0 4px;padding:0;vertical-align:middle;' +
    'background:#e8a33d;color:#16130f;border:none;border-radius:6px;cursor:pointer;';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    void chrome.runtime.sendMessage({ target: 'sw', type: 'share-fetch', url: a.href });
    btn.style.opacity = '0.5';
    setTimeout(() => { btn.style.opacity = '1'; }, 1500);
  });
  a.after(btn);
}

function scan(root: ParentNode): void {
  for (const a of root.querySelectorAll<HTMLAnchorElement>(`a[href]:not([${MARK}])`)) {
    inject(a);
  }
}

let scheduled = false;
const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    scan(document);
  }, 800);
});

scan(document);
observer.observe(document.body, { childList: true, subtree: true });
