/**
 * Ayarlar sayfası — tam sekme.
 *
 * Neden ayrı sayfa: 11 ayar satırı + 28 servis + Beam + tanılama, side panel'in
 * ~320 px'lik sütununda kaydırmalı çekmeceye sıkışmıştı. Panel indirme İZLEME
 * yeridir; yapılandırma buraya taşındı (chrome.runtime.openOptionsPage).
 * Ayar mantığı panelden TAŞINDI, kopyalanmadı — tek kaynak burası.
 */
import type { Msg } from '../engine/types';
import { DEFAULT_MODE, type ServiceMode } from '../content/modes';
import { SERVICES } from '../content/services';
import { icons } from '../sidepanel/icons';
import { initBeamUi } from '../sidepanel/beam-ui';
import { $, applyI18n, escapeHtml, fmtBytes, SETTING_DEFAULTS, t } from '../sidepanel/common';

applyI18n();
$('#opt-logo').innerHTML = icons.logo;
for (const el of document.querySelectorAll<HTMLElement>('.set-icon[data-icon]')) {
  el.innerHTML = icons[el.dataset['icon'] as keyof typeof icons] ?? '';
}

const send = (msg: Msg): void => {
  void chrome.runtime.sendMessage(msg).catch(() => undefined);
};
const save = (patch: Record<string, unknown>): void => {
  void chrome.storage.local.set(patch);
};

// ── Ayar satırları ───────────────────────────────────────────────────────────
const setDefault = $<HTMLInputElement>('#set-default');
const setTakeover = $<HTMLInputElement>('#set-takeover');
const setMinMb = $<HTMLInputElement>('#set-minmb');
const setFolders = $<HTMLInputElement>('#set-folders');
const setRetries = $<HTMLInputElement>('#set-retries');
const setQueue = $<HTMLInputElement>('#set-queue');
const setHelper = $<HTMLInputElement>('#set-helper');
const setAfterClose = $<HTMLInputElement>('#set-afterclose');
const setNotify = $<HTMLSelectElement>('#set-notify');
const setParty = $<HTMLInputElement>('#set-party');
const partyRow = $('#party-row');
const setOpen = $<HTMLInputElement>('#set-open');

void chrome.storage.local.get(SETTING_DEFAULTS).then((s) => {
  setDefault.checked = Boolean(s['defaultExperience']);
  setTakeover.checked = Boolean(s['takeover']);
  setMinMb.value = String(s['takeoverMinMB']);
  setFolders.checked = Boolean(s['typeFolders']);
  setRetries.value = String(s['maxRetries']);
  setQueue.value = String(s['queueLimit']);
  setHelper.checked = Boolean(s['useHelper']);
  setAfterClose.checked = Boolean(s['continueAfterClose']);
  setAfterClose.disabled = !s['useHelper'];
  setNotify.value = String(s['notifyMode']);
  setParty.value = String(s['partyUrl']);
  partyRow.hidden = s['notifyMode'] !== 'party';
  setOpen.checked = Boolean(s['openWhenDone']);
});

setDefault.addEventListener('change', () => save({ defaultExperience: setDefault.checked }));
setTakeover.addEventListener('change', () => save({ takeover: setTakeover.checked }));
setMinMb.addEventListener('change', () => save({ takeoverMinMB: Math.max(0, Number(setMinMb.value) || 0) }));
setFolders.addEventListener('change', () => save({ typeFolders: setFolders.checked }));
setRetries.addEventListener('change', () => save({ maxRetries: Math.min(10, Math.max(0, Number(setRetries.value) || 0)) }));
setQueue.addEventListener('change', () => save({ queueLimit: Math.min(20, Math.max(0, Number(setQueue.value) || 0)) }));
setNotify.addEventListener('change', () => {
  partyRow.hidden = setNotify.value !== 'party';
  save({ notifyMode: setNotify.value });
});
setParty.addEventListener('change', () => save({ partyUrl: setParty.value.trim() || SETTING_DEFAULTS.partyUrl }));
setOpen.addEventListener('change', () => save({ openWhenDone: setOpen.checked }));

// ── Yardımcı uygulama ────────────────────────────────────────────────────────
const helperInstall = $('#helper-install');
const helperCmd = $('#helper-cmd');
const helperCopy = $<HTMLButtonElement>('#helper-copy');

/** Kurulum komutu — kullanıcının KENDİ eklenti kimliği gömülü gelir. */
const INSTALL_CMD = `curl -fsSL https://raw.githubusercontent.com/mehmetnadir/ruu-downloader/main/helper/install.sh | bash -s -- ${chrome.runtime.id}`;

function showHelperInstall(show: boolean): void {
  helperInstall.hidden = !show;
  if (show) helperCmd.textContent = INSTALL_CMD;
}

helperCopy.textContent = t('helpCopy');
helperCopy.addEventListener('click', () => {
  void navigator.clipboard.writeText(INSTALL_CMD).then(() => {
    helperCopy.textContent = t('helpCopied');
    setTimeout(() => { helperCopy.textContent = t('helpCopy'); }, 2000);
  }).catch(() => undefined);
});

// Yardımcı AÇILIRKEN izin istenir; kullanıcı reddederse ya da program kurulu
// değilse kutu geri kapanır — sessizce "açık" görünüp çalışmaması yanıltıcı olur.
setHelper.addEventListener('change', () => {
  if (!setHelper.checked) {
    save({ useHelper: false, continueAfterClose: false });
    setAfterClose.disabled = true;
    showHelperInstall(false);
    return;
  }
  send({ target: 'sw', type: 'enable-helper' });
});
setAfterClose.addEventListener('change', () => save({ continueAfterClose: setAfterClose.checked }));

chrome.runtime.onMessage.addListener((raw: Msg) => {
  if (raw.target !== 'panel') return;
  if (raw.type === 'helper-result') {
    setHelper.checked = raw.ok;
    setAfterClose.disabled = !raw.ok;
    showHelperInstall(!raw.ok && raw.needsInstall === true);
    if (!raw.ok) $('#live-region').textContent = t('errHelperMissing');
    send({ target: 'sw', type: 'helper-query' }); // bant + ikon tazelensin
  }
  if (raw.type === 'helper-state') renderStatus(raw.enabled, raw.up, raw.version);
});

// ── Durum bandı: yardımcı bağlantısı bir bakışta ─────────────────────────────
// Araç çubuğu ikonuyla aynı gerçeği söyler: bant yeşilse ikon ters renktedir.
const hstatus = $('#hstatus');
const hstatusMsg = $('#hstatus-msg');
const hstatusCmd = $('#hstatus-cmd');
const hstatusRetry = $<HTMLButtonElement>('#hstatus-retry');

/**
 * Kurulum tarifi işletim sistemine göre seçilir — kullanıcıya üç sistemin
 * tarifini birden gösterip "senin olanı bul" demek tarif sayılmaz.
 */
function osCommand(): string {
  const plat = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData?.platform ?? navigator.platform;
  if (/win/i.test(plat)) {
    return `$env:RUU_EXT_ID='${chrome.runtime.id}'; iwr -useb https://raw.githubusercontent.com/mehmetnadir/ruu-downloader/main/helper/install.ps1 | iex`;
  }
  return INSTALL_CMD; // macOS ve Linux aynı bash kurucusunu paylaşır
}

function renderStatus(enabled: boolean, up: boolean, version?: string): void {
  const state = !enabled ? 'off' : up ? 'up' : 'down';
  hstatus.dataset['state'] = state;
  hstatusMsg.textContent = state === 'up'
    ? `${t('hsUp')}${version ? ` · v${version}` : ''}`
    : state === 'off' ? t('hsOff') : t('hsDown');
  hstatusCmd.hidden = state !== 'down';
  if (state === 'down') hstatusCmd.textContent = osCommand();
  hstatusRetry.hidden = state !== 'down';
}

hstatusRetry.addEventListener('click', () => {
  send({ target: 'sw', type: 'helper-query' });
});

// Sayfa açılışında taze durum iste
send({ target: 'sw', type: 'helper-query' });

// Ayar başka bir bağlamdan değişirse (panel onboard'u, SW) kutu ile durum
// bandı ÇELİŞMEMELİ — useHelper'ı canlı izle.
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local' || !ch['useHelper']) return;
  const on = Boolean(ch['useHelper'].newValue);
  setHelper.checked = on;
  setAfterClose.disabled = !on;
  send({ target: 'sw', type: 'helper-query' });
});

// ── Paylaşım servisleri: kapalı / sor / otomatik ─────────────────────────────
const svcList = $('#svc-list');
const MODE_LABEL: Record<ServiceMode, string> = {
  off: t('mOff'), ask: t('mAsk'), auto: t('mAuto'),
};
let svcModes: Record<string, ServiceMode> = {};

function renderServices(): void {
  svcList.innerHTML = SERVICES.map((svc) => {
    const cur = svcModes[svc.id] ?? DEFAULT_MODE;
    const opts = (['off', 'ask', 'auto'] as ServiceMode[])
      .map((m) => `<option value="${m}"${m === cur ? ' selected' : ''}>${MODE_LABEL[m]}</option>`)
      .join('');
    const mark = svc.kind === 'unaccel' ? ' <span class="svc-mark">•</span>' : '';
    return `<div class="svc-row"><span class="svc-name">${svc.name}${mark}</span>` +
      `<select class="svc-mode" data-svc="${svc.id}" aria-label="${svc.name}">${opts}</select></div>`;
  }).join('');
}

void chrome.storage.local.get({ serviceModes: {} }).then((s) => {
  svcModes = (s['serviceModes'] ?? {}) as Record<string, ServiceMode>;
  renderServices();
});

svcList.addEventListener('change', (e) => {
  const sel = e.target as HTMLSelectElement;
  if (!sel.classList.contains('svc-mode')) return;
  svcModes = { ...svcModes, [sel.dataset['svc']!]: sel.value as ServiceMode };
  save({ serviceModes: svcModes });
});

const setAll = (mode: ServiceMode): void => {
  svcModes = Object.fromEntries(SERVICES.map((s) => [s.id, mode]));
  save({ serviceModes: svcModes });
  renderServices();
};
$('#svc-all-auto').addEventListener('click', () => setAll('auto'));
$('#svc-all-ask').addEventListener('click', () => setAll('ask'));

// Öneri: telemetri YOK — kullanıcı GitHub'da hazır doldurulmuş bir issue açar
$('#svc-suggest').addEventListener('click', () => {
  const body = encodeURIComponent(
    'Servis adı:\n\nÖrnek paylaşım linki (isteğe bağlı):\n\nNotlar:\n',
  );
  void chrome.tabs.create({
    url: 'https://github.com/mehmetnadir/ruu-downloader/issues/new' +
      `?title=${encodeURIComponent('Servis önerisi: ')}&body=${body}&labels=service-request`,
  });
});

// ── Devralma teşhis günlüğü ──────────────────────────────────────────────────
const diagList = $('#diag-list');
const DIAG_LABEL: Record<string, string> = {
  taken: t('dTaken'), small: t('dSmall'), scheme: t('dScheme'),
  disabled: t('dDisabled'), 'not-active': t('dNotActive'), 'cancel-failed': t('dCancelFailed'),
  unaccel: t('dUnaccel'), 'share-open': t('dTaken'), 'share-auto': t('dTaken'),
  'engine-failed': t('dCancelFailed'),
};
function renderDiag(log: Array<{ url: string; action: string; size?: number }>): void {
  diagList.innerHTML = log.slice(0, 5).map((e) => {
    const sz = e.size && e.size > 0 ? ` · ${fmtBytes(e.size)}` : '';
    const cls = e.action === 'taken' ? 'ok' : 'skip';
    return `<div class="diag-row ${cls}"><span class="diag-url" title="${escapeHtml(e.url)}">${escapeHtml(e.url)}</span><span class="diag-why">${DIAG_LABEL[e.action] ?? e.action}${sz}</span></div>`;
  }).join('') || `<div class="diag-row skip"><span class="diag-why">—</span></div>`;
}
void chrome.storage.local.get({ takeoverLog: [] })
  .then((s) => renderDiag(s['takeoverLog'] as Array<{ url: string; action: string; size?: number }>));
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch['takeoverLog']) {
    renderDiag(ch['takeoverLog'].newValue as Array<{ url: string; action: string; size?: number }>);
  }
});

// ── Beam: telefon → bu bilgisayar ────────────────────────────────────────────
initBeamUi($('#beam-body'));
