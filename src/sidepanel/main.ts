import type { JobSnapshot, Msg } from '../engine/types';
import { icons } from './icons';

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

const urlInput = $<HTMLInputElement>('#url-input');
const addBtn = $<HTMLButtonElement>('#add-btn');
const activeList = $('#active-list');
const doneList = $('#done-list');
const activeCount = $('#active-count');
const doneCount = $('#done-count');
const emptyHint = $('#empty-hint');
const liveRegion = $('#live-region');

const SEG_BUCKETS = 48;

/** Tek-kelime durum sözcükleri (Claude tarzı) — i18n-hazır, minimal metin. */
const FLOW_WORDS = ['İniyor', 'Akıyor', 'Sürüyor', 'Hızlanıyor', 'Taşınıyor'];
const STATE_WORDS: Record<JobSnapshot['state'], string> = {
  probing: 'Bağlanıyor',
  downloading: FLOW_WORDS[0]!,
  paused: 'Bekliyor',
  finalizing: 'Yerleşiyor',
  done: 'İndi',
  error: 'Takıldı',
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

void chrome.storage.local.get(DEFAULTS).then((s) => {
  onboard.hidden = Boolean(s['onboarded']);
  setDefault.checked = Boolean(s['defaultExperience']);
  setTakeover.checked = Boolean(s['takeover']);
  setMinMb.value = String(s['takeoverMinMB']);
  setFolders.checked = Boolean(s['typeFolders']);
  setRetries.value = String(s['maxRetries']);
});

const save = (patch: Record<string, unknown>): void => {
  void chrome.storage.local.set(patch);
};
setDefault.addEventListener('change', () => save({ defaultExperience: setDefault.checked }));
setTakeover.addEventListener('change', () => save({ takeover: setTakeover.checked }));
setMinMb.addEventListener('change', () => save({ takeoverMinMB: Math.max(0, Number(setMinMb.value) || 0) }));
setFolders.addEventListener('change', () => save({ typeFolders: setFolders.checked }));
setRetries.addEventListener('change', () => save({ maxRetries: Math.min(10, Math.max(0, Number(setRetries.value) || 0)) }));

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

function actionButtons(job: JobSnapshot): string {
  let out = '';
  if (job.state === 'downloading') {
    out += `<button class="icon-btn" data-act="pause" data-id="${job.id}" aria-label="Duraklat" title="Duraklat">${icons.pause}</button>`;
  } else if (job.state === 'paused') {
    out += `<button class="icon-btn" data-act="resume" data-id="${job.id}" aria-label="Devam et" title="Devam et">${icons.play}</button>`;
  }
  if (job.state !== 'done') {
    out += `<button class="icon-btn" data-act="cancel" data-id="${job.id}" aria-label="İptal et" title="İptal et">${icons.x}</button>`;
  }
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
      liveRegion.textContent = `${job.filename} indirildi`;
    }
    if (job.state === 'error') {
      liveRegion.textContent = `${job.filename}: ${job.error ?? 'hata'}`;
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
    ref.stats.textContent = job.error ?? '';
  } else if (job.state === 'done' && job.native) {
    ref.stats.textContent = 'tarayıcıya devredildi';
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
  const act = btn.dataset['act'] as 'pause' | 'resume' | 'cancel';
  const jobId = btn.dataset['id']!;
  send({ target: 'sw', type: act, jobId });
});

chrome.runtime.onMessage.addListener((raw: Msg) => {
  if (raw.target === 'panel' && raw.type === 'jobs') render(raw.jobs);
});

send({ target: 'sw', type: 'hello-panel' });
