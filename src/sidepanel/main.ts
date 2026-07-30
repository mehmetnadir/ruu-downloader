import type { JobSnapshot, Msg } from '../engine/types';
import { icons } from './icons';

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

// ── i18n ─────────────────────────────────────────────────────────────────────
const t = (key: string): string => chrome.i18n.getMessage(key) || key;
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
/** Motor hata anahtarlarını yerelleştir; bilinmeyenler ham geçer. */
const ERR_KEYS = new Set(['errChanged', 'errCancelled', 'errAllDown', 'errDelivery']);
const terr = (err: string | undefined): string =>
  err && ERR_KEYS.has(err) ? t(err) : (err ?? '');

const urlInput = $<HTMLInputElement>('#url-input');
const addBtn = $<HTMLButtonElement>('#add-btn');
const activeList = $('#active-list');
const doneList = $('#done-list');
const activeCount = $('#active-count');
const doneCount = $('#done-count');
const emptyHint = $('#empty-hint');
const liveRegion = $('#live-region');

const SEG_BUCKETS = 48;

/** Tek-kelime durum sözcükleri (Claude tarzı) — yerelden gelir. */
const FLOW_WORDS = [t('f1'), t('f2'), t('f3'), t('f4'), t('f5')];
const STATE_WORDS: Record<JobSnapshot['state'], string> = {
  probing: t('wProbing'),
  downloading: FLOW_WORDS[0]!,
  paused: t('wPaused'),
  finalizing: t('wFinalizing'),
  done: t('wDone'),
  error: t('wError'),
};

function send(msg: Msg): void {
  void chrome.runtime.sendMessage(msg).catch(() => undefined);
}

function addFromInput(): void {
  const url = urlInput.value.trim();
  if (!url) return;
  send({ target: 'sw', type: 'add', url }); // bağlantı sayısı: motor cihaza göre otomatik seçer
  urlInput.value = '';
}

addBtn.addEventListener('click', addFromInput);
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addFromInput(); });
$('#pause-all').addEventListener('click', () => send({ target: 'sw', type: 'pause-all' }));

// ── Onboarding (tek seferlik) + Ayarlar ──────────────────────────────────────
const DEFAULTS = {
  onboarded: false,
  defaultExperience: false,
  takeover: true,
  takeoverMinMB: 10,
  typeFolders: true,
  maxRetries: 1,
  notifyMode: 'notify',
  partyUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  openWhenDone: false,
};

const settingsBtn = $<HTMLButtonElement>('#settings-btn');
settingsBtn.innerHTML = icons.sliders;
for (const el of document.querySelectorAll<HTMLElement>('.set-icon[data-icon]')) {
  el.innerHTML = icons[el.dataset['icon'] as keyof typeof icons] ?? '';
}
const settingsPanel = $('#settings');
const onboard = $('#onboard');

settingsBtn.addEventListener('click', () => {
  const open = settingsPanel.hidden;
  settingsPanel.hidden = !open;
  settingsBtn.setAttribute('aria-expanded', String(open));
});

const setDefault = $<HTMLInputElement>('#set-default');
const setTakeover = $<HTMLInputElement>('#set-takeover');
const setMinMb = $<HTMLInputElement>('#set-minmb');
const setFolders = $<HTMLInputElement>('#set-folders');
const setRetries = $<HTMLInputElement>('#set-retries');
const setNotify = $<HTMLSelectElement>('#set-notify');
const setParty = $<HTMLInputElement>('#set-party');
const partyRow = $('#party-row');
const setOpen = $<HTMLInputElement>('#set-open');

void chrome.storage.local.get(DEFAULTS).then((s) => {
  onboard.hidden = Boolean(s['onboarded']);
  setDefault.checked = Boolean(s['defaultExperience']);
  setTakeover.checked = Boolean(s['takeover']);
  setMinMb.value = String(s['takeoverMinMB']);
  setFolders.checked = Boolean(s['typeFolders']);
  setRetries.value = String(s['maxRetries']);
  setNotify.value = String(s['notifyMode']);
  setParty.value = String(s['partyUrl']);
  partyRow.hidden = s['notifyMode'] !== 'party';
  setOpen.checked = Boolean(s['openWhenDone']);
});

const save = (patch: Record<string, unknown>): void => {
  void chrome.storage.local.set(patch);
};
setDefault.addEventListener('change', () => save({ defaultExperience: setDefault.checked }));
setTakeover.addEventListener('change', () => save({ takeover: setTakeover.checked }));
setMinMb.addEventListener('change', () => save({ takeoverMinMB: Math.max(0, Number(setMinMb.value) || 0) }));
setFolders.addEventListener('change', () => save({ typeFolders: setFolders.checked }));
setRetries.addEventListener('change', () => save({ maxRetries: Math.min(10, Math.max(0, Number(setRetries.value) || 0)) }));
setNotify.addEventListener('change', () => {
  partyRow.hidden = setNotify.value !== 'party';
  save({ notifyMode: setNotify.value });
});
setParty.addEventListener('change', () => save({ partyUrl: setParty.value.trim() || DEFAULTS.partyUrl }));
setOpen.addEventListener('change', () => save({ openWhenDone: setOpen.checked }));

// ── Yerel istatistik satırı ──────────────────────────────────────────────────
const statsLine = $('#stats-line');
function renderStats(s: { count: number; bytes: number; bestSpeed: number } | undefined): void {
  if (!s || s.count === 0) { statsLine.hidden = true; return; }
  statsLine.hidden = false;
  statsLine.textContent = `${s.count} ${t('statsDl')} · ${fmtBytes(s.bytes)} · ↑ ${fmtBytes(s.bestSpeed)}/s`;
}
void chrome.storage.local.get({ stats: { count: 0, bytes: 0, bestSpeed: 0 } })
  .then((s) => renderStats(s['stats'] as { count: number; bytes: number; bestSpeed: number }));
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch['stats']) {
    renderStats(ch['stats'].newValue as { count: number; bytes: number; bestSpeed: number });
  }
});

$('#onboard-yes').addEventListener('click', () => {
  save({ onboarded: true, defaultExperience: true, takeover: true });
  setDefault.checked = true;
  setTakeover.checked = true;
  onboard.hidden = true;
});
$('#onboard-no').addEventListener('click', () => {
  save({ onboarded: true, defaultExperience: false, takeover: false });
  setTakeover.checked = false;
  onboard.hidden = true;
});

function fmtBytes(n: number): string {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(2)} GB`;
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(0)} KB`;
  return `${n} B`;
}

function fmtEta(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '';
  if (sec < 60) return `${Math.ceil(sec)}sn`;
  return `${Math.floor(sec / 60)}dk ${Math.ceil(sec % 60)}sn`;
}

// ── Keyed renderer ───────────────────────────────────────────────────────────
// Kart DOM'u iş başına BİR KEZ kurulur, sonraki güncellemeler yerinde yapılır;
// innerHTML yeniden kurulumu animasyonları sıfırladığı için yasak.

interface CardRef {
  el: HTMLElement;
  fill: HTMLElement;
  fname: HTMLElement;
  fsize: HTMLElement;
  word: HTMLElement;
  stats: HTMLElement;
  actions: HTMLElement;
  buckets: HTMLElement[];
  state: JobSnapshot['state'] | '';
  wordText: string;
  wordIdx: number;
}

const cards = new Map<string, CardRef>();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function createCard(job: JobSnapshot): CardRef {
  const el = document.createElement('div');
  el.setAttribute('role', 'listitem');
  el.dataset['id'] = job.id;
  el.className = 'card';
  el.innerHTML = `
    <div class="card-bg"><div class="card-fill"><div class="flow"></div></div></div>
    <div class="card-content">
      <div class="row1">
        <span class="beat-dot" aria-hidden="true"></span>
        <span class="fname"></span>
        <span class="fsize"></span>
      </div>
      <div class="segbar" aria-hidden="true">${'<div class="seg"><div class="f"></div></div>'.repeat(SEG_BUCKETS)}</div>
      <div class="row2">
        <span class="statusline"><span class="word"></span><span class="stats"></span></span>
        <span class="actions"></span>
      </div>
    </div>`;
  const ref: CardRef = {
    el,
    fill: el.querySelector('.card-fill')!,
    fname: el.querySelector('.fname')!,
    fsize: el.querySelector('.fsize')!,
    word: el.querySelector('.word')!,
    stats: el.querySelector('.stats')!,
    actions: el.querySelector('.actions')!,
    buckets: [...el.querySelectorAll<HTMLElement>('.seg > .f')],
    state: '',
    wordText: '',
    wordIdx: Math.floor(Math.random() * FLOW_WORDS.length),
  };
  cards.set(job.id, ref);
  return ref;
}

function setWord(ref: CardRef, text: string): void {
  if (ref.wordText === text) return;
  ref.wordText = text;
  ref.word.textContent = text;
  if (!reducedMotion.matches) {
    ref.word.animate(
      [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }],
      { duration: 220, easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)' },
    );
  }
}

function btn(act: string, idAttr: string, idVal: string | number, label: string, icon: string): string {
  return `<button class="icon-btn" data-act="${act}" data-${idAttr}="${idVal}" aria-label="${label}" title="${label}">${icon}</button>`;
}

function actionButtons(job: JobSnapshot): string {
  let out = '';
  if (job.state === 'downloading') out += btn('pause', 'id', job.id, t('pause'), icons.pause);
  else if (job.state === 'paused') out += btn('resume', 'id', job.id, t('resume'), icons.play);
  if (job.state === 'done' && job.downloadId !== undefined && !job.native) {
    out += btn('open', 'dlid', job.downloadId, t('openFile'), icons.open);
    out += btn('show', 'dlid', job.downloadId, t('showFolder'), icons.show);
  }
  if (job.state !== 'done') out += btn('cancel', 'id', job.id, t('cancel'), icons.x);
  return out;
}

function updateCard(ref: CardRef, job: JobSnapshot): void {
  const pct = job.size ? job.downloaded / job.size : 0;

  if (ref.state !== job.state) {
    const prev = ref.state;
    ref.state = job.state;
    ref.el.className = `card ${job.state}`;
    ref.actions.innerHTML = actionButtons(job);
    setWord(ref, STATE_WORDS[job.state]);
    if (job.state === 'done' && prev && prev !== 'done') {
      liveRegion.textContent = `${job.filename} — ${t('wDone')}`;
    }
    if (job.state === 'error') {
      liveRegion.textContent = `${job.filename}: ${terr(job.error)}`;
    }
  }

  ref.fname.textContent = job.filename;
  ref.fname.title = job.url;
  ref.fsize.textContent = job.size ? fmtBytes(job.size) : '';
  ref.fill.style.width = `${(pct * 100).toFixed(2)}%`;

  if (job.state === 'downloading') {
    const eta = job.speed > 0 && job.size ? (job.size - job.downloaded) / job.speed : NaN;
    const parts = [`${fmtBytes(job.speed)}/s`, `%${Math.floor(pct * 100)}`];
    const etaTxt = fmtEta(eta);
    if (etaTxt) parts.push(etaTxt);
    ref.stats.textContent = parts.join(' · ');
  } else if (job.state === 'paused') {
    ref.stats.textContent = `%${Math.floor(pct * 100)}`;
  } else if (job.state === 'error') {
    ref.stats.textContent = terr(job.error);
  } else if (job.state === 'done' && job.native) {
    ref.stats.textContent = t('wNative');
  } else {
    ref.stats.textContent = '';
  }

  // Segment haritası: 48 sabit bucket; node yeniden kurulmaz, opacity güncellenir.
  if ((job.state === 'downloading' || job.state === 'paused') && job.size) {
    ref.el.classList.add('has-segbar');
    const size = job.size;
    const bucketOf = (byte: number): number =>
      Math.min(SEG_BUCKETS - 1, Math.floor((byte / size) * SEG_BUCKETS));
    const fillPer = new Float32Array(SEG_BUCKETS);
    const activeSet = new Set<number>();
    for (const c of job.claims) {
      if (c.w > 0) {
        const s = bucketOf(c.s);
        const e = bucketOf(c.s + c.w - 1);
        for (let b = s; b <= e; b++) fillPer[b] = 1;
        // uç bucket kısmi olabilir; basit yaklaşım: uçta oran uygula
        const bucketSize = size / SEG_BUCKETS;
        fillPer[e] = Math.min(1, ((c.s + c.w) - e * bucketSize) / bucketSize);
        if (s === e) fillPer[s] = Math.min(1, c.w / bucketSize);
      }
      if (c.a) activeSet.add(bucketOf(c.s + c.w));
    }
    for (let b = 0; b < SEG_BUCKETS; b++) {
      const f = ref.buckets[b]!;
      f.style.opacity = String(fillPer[b]);
      f.parentElement!.classList.toggle('active', activeSet.has(b));
    }
  } else {
    ref.el.classList.remove('has-segbar');
  }
}

function render(jobsList: JobSnapshot[]): void {
  const seen = new Set<string>();
  let active = 0;
  let done = 0;

  for (const job of jobsList) {
    seen.add(job.id);
    const ref = cards.get(job.id) ?? createCard(job);
    updateCard(ref, job);
    const targetList = job.state === 'done' ? doneList : activeList;
    if (ref.el.parentElement !== targetList) targetList.appendChild(ref.el);
    if (job.state === 'done') done++; else active++;
  }

  for (const [id, ref] of cards) {
    if (!seen.has(id)) {
      ref.el.remove();
      cards.delete(id);
    }
  }

  activeCount.textContent = active ? `(${active})` : '';
  doneCount.textContent = done ? `(${done})` : '';
  emptyHint.style.display = jobsList.length ? 'none' : '';
}

// Akış sözcüğü rotasyonu: aktif kartlarda 4 sn'de bir yumuşak geçiş.
setInterval(() => {
  for (const ref of cards.values()) {
    if (ref.state === 'downloading') {
      ref.wordIdx = (ref.wordIdx + 1) % FLOW_WORDS.length;
      setWord(ref, FLOW_WORDS[ref.wordIdx]!);
    }
  }
}, 4000);

document.body.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!btn) return;
  const act = btn.dataset['act']!;
  if (act === 'open' || act === 'show') {
    const dlid = Number(btn.dataset['dlid']);
    try {
      if (act === 'open') chrome.downloads.open(dlid); // panel tıklaması = user gesture
      else chrome.downloads.show(dlid);
    } catch { /* dosya taşınmış olabilir */ }
    return;
  }
  const jobId = btn.dataset['id']!;
  send({ target: 'sw', type: act as 'pause' | 'resume' | 'cancel', jobId });
});

chrome.runtime.onMessage.addListener((raw: Msg) => {
  if (raw.target === 'panel' && raw.type === 'jobs') render(raw.jobs);
});

send({ target: 'sw', type: 'hello-panel' });
