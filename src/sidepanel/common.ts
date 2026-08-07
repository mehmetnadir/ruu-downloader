/**
 * Panel ve ayarlar sayfasının paylaştığı temel yardımcılar.
 *
 * Ayarlar tam sayfaya taşınınca (2026-08-07) bu ikisi ayrı bundle oldu;
 * fmtBytes/i18n gibi şeyleri iki yerde kopyalamak bakım riski — tek kaynak.
 */

export const $ = <T extends HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T;

export const t = (key: string): string => chrome.i18n.getMessage(key) || key;

/** data-i18n / data-i18n-title / data-i18n-ph özniteliklerini doldurur. */
export function applyI18n(): void {
  document.documentElement.dir = chrome.i18n.getMessage('@@bidi_dir') || 'ltr';
  document.documentElement.lang = chrome.i18n.getUILanguage();
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.textContent = t(el.dataset['i18n']!);
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    const label = t(el.dataset['i18nTitle']!);
    el.title = label;
    el.setAttribute('aria-label', label);
  }
  for (const el of document.querySelectorAll<HTMLInputElement>('[data-i18n-ph]')) {
    el.placeholder = t(el.dataset['i18nPh']!);
  }
}

export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function fmtBytes(n: number): string {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(2)} GB`;
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(0)} KB`;
  return `${n} B`;
}

/** Paylaşılan ayar varsayılanları — SW'dekiyle aynı anahtarlar. */
export const SETTING_DEFAULTS = {
  onboarded: false,
  defaultExperience: false,
  takeover: true,
  takeoverMinMB: 10,
  typeFolders: true,
  maxRetries: 1,
  queueLimit: 0,
  useHelper: false,
  continueAfterClose: false,
  notifyMode: 'notify',
  partyUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  openWhenDone: false,
};
