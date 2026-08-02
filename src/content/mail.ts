/**
 * Mail content script — SADECE Gmail/Outlook'ta çalışır (manifest matches).
 * Tanınan paylaşım linklerinin yanına CANLI (animasyonlu) Ruu düğmesi ekler:
 * beklerken hafif nabız, tıklanınca dönen halka, indirme başlayınca yeşil tik,
 * süresi dolmuş linkte kırmızı uyarı. Kullanıcı eklentinin işi takip ettiğini
 * anlık görür. Sayfa verisi OKUNMAZ, yalnızca link href'leri eşlenir.
 */
import { autoKey, modeFor, type ServiceMode } from './modes';
import { matchShareLink } from './patterns';

const MARK = 'data-ruu-btn';
const t = (k: string): string => chrome.i18n.getMessage(k) || k;

const ICON =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" ' +
  'stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/></svg>';
const CHECK =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" ' +
  'stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>';
const WARN =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" ' +
  'stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 8v5"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>';

const STYLE = `
.ruu-b{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;
margin:0 5px;padding:0;vertical-align:middle;background:#e8a33d;color:#16130f;border:none;
border-radius:6px;cursor:pointer;position:relative;
transition:background .18s ease,transform .18s ease,width .2s ease}
.ruu-b:hover{transform:translateY(-1px) scale(1.06)}
.ruu-b:active{transform:scale(.92)}
.ruu-b.ruu-idle{animation:ruu-breathe 2.6s ease-in-out infinite}
.ruu-b.ruu-work{background:#c9882a;animation:none}
.ruu-b.ruu-work::after{content:"";position:absolute;inset:-3px;border-radius:8px;
border:2px solid rgba(232,163,61,.9);border-top-color:transparent;animation:ruu-spin .8s linear infinite}
.ruu-b.ruu-ok{background:#7fb069;animation:ruu-pop .35s cubic-bezier(.22,1,.36,1)}
.ruu-b.ruu-err{background:#d95d4e;color:#fff;animation:ruu-shake .4s ease}
@keyframes ruu-breathe{0%,100%{box-shadow:0 0 0 0 rgba(232,163,61,.55)}50%{box-shadow:0 0 0 5px rgba(232,163,61,0)}}
@keyframes ruu-spin{to{transform:rotate(360deg)}}
@keyframes ruu-pop{0%{transform:scale(.7)}60%{transform:scale(1.15)}100%{transform:scale(1)}}
@keyframes ruu-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}
@media (prefers-reduced-motion:reduce){.ruu-b,.ruu-b::after{animation:none!important;transition:none!important}}
`;

const pending = new Map<string, HTMLButtonElement>();
/** Bu sekmede otomatik başlatılan linkler — aynı transfer iki kez inmesin. */
const autoStarted = new Set<string>();
let serviceModes: Record<string, ServiceMode> = {};
let globalAuto = false;

function startFlow(url: string, btn?: HTMLButtonElement): void {
  const reqId = `r${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  if (btn) {
    pending.set(reqId, btn);
    setState(btn, 'work', t('shWorking'));
  }
  void chrome.runtime.sendMessage({ target: 'sw', type: 'share-fetch', url, reqId })
    .catch(() => btn && setState(btn, 'err', t('shNoAction')));
}

function injectStyle(): void {
  if (document.getElementById('ruu-style')) return;
  const s = document.createElement('style');
  s.id = 'ruu-style';
  s.textContent = STYLE;
  (document.head ?? document.documentElement).append(s);
}

function setState(btn: HTMLButtonElement, state: 'idle' | 'work' | 'ok' | 'err', title: string): void {
  btn.className = `ruu-b ruu-${state}`;
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.innerHTML = state === 'ok' ? CHECK : state === 'err' ? WARN : ICON;
  if (state === 'ok' || state === 'err') {
    setTimeout(() => setState(btn, 'idle', t('ruuBtn')), 6000);
  }
}

function inject(a: HTMLAnchorElement): void {
  const match = matchShareLink(a.href);
  if (!match) return;
  a.setAttribute(MARK, '1');
  const mode = modeFor(match.service, serviceModes, globalAuto);
  if (mode === 'off') return;

  if (mode === 'auto') {
    // TAM OTOMATİK: kullanıcı bu servisi otomatiğe aldı — link görülür görülmez in.
    // Güvenlik: yalnızca GÖRÜNÜR link, sekme başına tek kez, izleme parametreleri
    // yok sayılarak tekilleştirilmiş.
    const key = autoKey(a.href);
    if (autoStarted.has(key) || a.offsetParent === null) return;
    autoStarted.add(key);
    startFlow(a.href);
    return;
  }
  // Aynı hedefe birden çok link olabilir (logo + metin + ham URL) — tek düğme yeter
  if (document.querySelector(`[data-ruu-for="${CSS.escape(a.href)}"]`)) return;

  const btn = document.createElement('button');
  btn.setAttribute('type', 'button');
  btn.setAttribute('data-ruu-for', a.href);
  setState(btn, 'idle', t('ruuBtn'));
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    startFlow(a.href, btn);
  });
  a.after(btn);
}

function scan(root: ParentNode): void {
  for (const a of root.querySelectorAll<HTMLAnchorElement>(`a[href]:not([${MARK}])`)) {
    inject(a);
  }
}

chrome.runtime.onMessage.addListener((msg: { target?: string; type?: string; reqId?: string; state?: string }) => {
  if (msg.target !== 'mail' || msg.type !== 'share-status') return;
  const btn = pending.get(msg.reqId ?? '');
  if (!btn) return;
  switch (msg.state) {
    case 'started': setState(btn, 'ok', t('shStarted')); pending.delete(msg.reqId!); break;
    case 'expired': setState(btn, 'err', t('shExpired')); pending.delete(msg.reqId!); break;
    case 'noaction': setState(btn, 'err', t('shNoAction')); pending.delete(msg.reqId!); break;
  }
});

let scheduled = false;
const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    scan(document);
  }, 800);
});

injectStyle();
// Modlar yüklendikten SONRA tara — 'auto' servisler ilk taramada kaçmasın
void chrome.storage.local.get({ serviceModes: {}, globalAuto: false }).then((s) => {
  serviceModes = (s['serviceModes'] ?? {}) as Record<string, ServiceMode>;
  globalAuto = Boolean(s['globalAuto']);
  scan(document);
  observer.observe(document.body, { childList: true, subtree: true });
});
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local') return;
  if (ch['serviceModes']) serviceModes = (ch['serviceModes'].newValue ?? {}) as Record<string, ServiceMode>;
  if (ch['globalAuto']) globalAuto = Boolean(ch['globalAuto'].newValue);
});
