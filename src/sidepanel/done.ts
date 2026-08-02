/**
 * "Dosyanız indirildi" sekmesi — notifyMode 'tab' seçildiğinde SW açar.
 * Parametreler URL'de taşınır: ?id=<downloadId>&n=<ad>&s=<byte>
 */
const t = (k: string): string => chrome.i18n.getMessage(k) || k;
const params = new URLSearchParams(location.search);
const downloadId = Number(params.get('id'));
const fileName = params.get('n') ?? '';
const size = Number(params.get('s'));

document.documentElement.dir = chrome.i18n.getMessage('@@bidi_dir') || 'ltr';
for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
  el.textContent = t(el.dataset['i18n']!);
}

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(2)} GB`;
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(0)} KB`;
  return `${n} B`;
}

document.title = `${t('nTitle')}`;
(document.getElementById('fname') as HTMLElement).textContent = fileName || t('nMsg');
(document.getElementById('fmeta') as HTMLElement).textContent =
  [fmtBytes(size), t('wDone')].filter(Boolean).join(' · ');

document.getElementById('open')!.addEventListener('click', () => {
  // sayfa tıklaması = user gesture → downloads.open izinli
  if (downloadId) chrome.downloads.open(downloadId);
});
document.getElementById('show')!.addEventListener('click', () => {
  if (downloadId) chrome.downloads.show(downloadId);
});
