import type { JobSnapshot, Msg } from '../engine/types';
import { DEFAULT_MODE, type ServiceMode } from '../content/modes';
import {
  DEFAULT_SORT, isSortMode, sortEntries, SORT_MODES,
  type HistoryEntry, type SortMode,
} from '../engine/history';
import { SERVICES } from '../content/services';
import { icons } from './icons';
import { $, applyI18n, escapeHtml, fmtBytes, SETTING_DEFAULTS, t } from './common';

// ── i18n ─────────────────────────────────────────────────────────────────────
applyI18n();
/** Motor hata anahtarlarını yerelleştir; bilinmeyenler ham geçer. */
const ERR_KEYS = new Set([
  'errChanged', 'errCancelled', 'errAllDown', 'errDelivery',
  'errBlocked', 'errDigest', 'errSaveCancelled',
]);
/**
 * Hata metnini kullanıcının dilinde gösterir.
 *
 * Çevirisi olmayan hatalar (Chrome API'sinden gelen ham İngilizce metinler)
 * eskiden AYNEN gösteriliyordu: Türkçe kullanan bir kullanıcı kartında
 * "Invalid filename" görüyordu. Teknik detayı atmıyoruz — anlaşılır bir
 * başlığın arkasına koyuyoruz.
 */
const terr = (err: string | undefined): string => {
  if (!err) return '';
  if (ERR_KEYS.has(err)) return t(err);
  return `${t('errUnknown')} — ${err}`;
};

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
  queued: t('wQueued'),
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

let privateMode = false;
let renewTarget: string | null = null;

function setRenewMode(jobId: string | null): void {
  renewTarget = jobId;
  urlInput.classList.toggle('renew', jobId !== null);
  urlInput.placeholder = jobId !== null ? t('renewPh') : t('addPh');
  if (jobId !== null) urlInput.focus();
}

function addFromInput(): void {
  const url = urlInput.value.trim();
  if (!url) return;
  if (renewTarget !== null) {
    // süresi dolan işe yeni link — kaldığı yerden devam
    send({ target: 'sw', type: 'renew', jobId: renewTarget, url });
    setRenewMode(null);
  } else {
    // bağlantı sayısı: motor cihaza göre otomatik seçer
    send({ target: 'sw', type: 'add', url, priv: privateMode || undefined });
  }
  urlInput.value = '';
}
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') setRenewMode(null); });

addBtn.addEventListener('click', addFromInput);
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addFromInput(); });
$('#pause-all').addEventListener('click', () => send({ target: 'sw', type: 'pause-all' }));

const privToggle = $<HTMLButtonElement>('#priv-toggle');
privToggle.innerHTML = icons.eyeOff;
privToggle.addEventListener('click', () => {
  privateMode = !privateMode;
  privToggle.setAttribute('aria-pressed', String(privateMode));
  privToggle.classList.toggle('toggled', privateMode);
});

// ── Onboarding (tek seferlik) + Ayarlar ──────────────────────────────────────
const DEFAULTS = {
  onboarded: false,
  defaultExperience: false,
  takeover: true,
  takeoverMinMB: 10,
  typeFolders: true,
  maxRetries: 1,
  queueLimit: 0,
  useHelper: false,
  continueAfterClose: false,
  modifierBypass: true,
  notifyMode: 'notify',
  partyUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  openWhenDone: false,
};

const settingsBtn = $<HTMLButtonElement>('#settings-btn');
settingsBtn.innerHTML = icons.sliders;
const onboard = $('#onboard');
void chrome.storage.local.get({ onboarded: false }).then((s2) => {
  onboard.hidden = Boolean(s2['onboarded']);
});

// Ayarlar artık TAM SAYFADA: 11 satır + 28 servis + Beam + tanılama, panelin
// ~320 px'lik sütununa kaydırmalı çekmece olarak sığmıyordu. Panel indirme
// İZLEME yeridir; yapılandırma options sayfasına taşındı (src/options/).
settingsBtn.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

// ── Kalıcı indirme geçmişi ───────────────────────────────────────────────────
// Chrome'un indirme balonunu gizlemeyi öneriyoruz; kendi geçmişimizi tutmamak
// kullanıcıyı iki arayüzden birden mahrum bırakırdı (denetim bulgusu C5).
const histSection = $('#hist-section');
const histList = $('#hist-list');
const histSort = $<HTMLSelectElement>('#hist-sort');

/**
 * Sıralama seçimi kalıcıdır: kullanıcı "ada göre"yi seçtiyse panel her
 * açılışında yeniden tarihe dönmemeli. Bilinmeyen/eski değer varsayılana düşer.
 */
let sortMode: SortMode = DEFAULT_SORT;
const SORT_LABELS: Record<SortMode, string> = {
  'date-desc': t('sortDateDesc'),
  'date-asc': t('sortDateAsc'),
  'name-asc': t('sortNameAsc'),
  'name-desc': t('sortNameDesc'),
  'size-desc': t('sortSizeDesc'),
  'size-asc': t('sortSizeAsc'),
};
histSort.title = t('sortLabel');
histSort.setAttribute('aria-label', t('sortLabel'));
histSort.innerHTML = SORT_MODES
  .map((m) => `<option value="${m}">${escapeHtml(SORT_LABELS[m])}</option>`).join('');

histSort.addEventListener('change', () => {
  if (!isSortMode(histSort.value)) return;
  sortMode = histSort.value;
  void chrome.storage.local.set({ histSort: sortMode });
  void renderHistory();
  render(lastJobs); // "Tamamlanan" kartları da aynı sırayı izler
});

async function renderHistory(): Promise<void> {
  const store = await chrome.storage.local.get({ history: [], histSort: DEFAULT_SORT });
  const saved = store['histSort'];
  sortMode = isSortMode(saved) ? saved : DEFAULT_SORT;
  histSort.value = sortMode;
  const entries = sortEntries(store['history'] as HistoryEntry[], sortMode);
  if (entries.length === 0) { histSection.hidden = true; return; }
  histSection.hidden = false;
  // Dosya hâlâ diskte mi? Silinmişse üstü çizili göster — yalan söyleme.
  const live = await chrome.downloads.search({}).catch(() => []);
  const exists = new Map(live.map((d) => [d.id, d.exists !== false && d.state === 'complete']));
  histList.innerHTML = entries.map((e) => {
    const when = new Date(e.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
    const meta = [fmtBytes(e.size), when, e.origin, e.sender].filter(Boolean).join(' · ');
    const gone = exists.get(e.id) === false;
    const actions = gone ? '' :
      btn('open', 'dlid', e.id, t('openFile'), icons.open) + btn('show', 'dlid', e.id, t('showFolder'), icons.show);
    return `<div class="hist-row${gone ? ' gone' : ''}" role="listitem">` +
      `<span class="hist-name" title="${escapeHtml(e.name)}">${escapeHtml(e.name)}</span>` +
      `<span class="hist-meta">${escapeHtml(meta)}</span>` +
      `<span class="actions">${actions}</span></div>`;
  }).join('');
}

$('#hist-clear').addEventListener('click', () => {
  void chrome.storage.local.set({ history: [] }).then(renderHistory);
});
void renderHistory();
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch['history']) void renderHistory();
});

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

const saveLocal = (patch: Record<string, unknown>): void => {
  void chrome.storage.local.set(patch);
};
$('#onboard-yes').addEventListener('click', () => {
  saveLocal({ onboarded: true, defaultExperience: true, takeover: true });
  onboard.hidden = true;
});
$('#onboard-no').addEventListener('click', () => {
  saveLocal({ onboarded: true, defaultExperience: false, takeover: false });
  onboard.hidden = true;
});

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
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
        ${job.priv ? `<span class="priv-badge" title="${t('privT')}">${icons.eyeOff}</span>` : ''}
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
  // idVal artık URL de taşıyor — attribute'a ham gömmek tırnak/& ile kırılır.
  return `<button class="icon-btn" data-act="${act}" data-${idAttr}="${escapeHtml(String(idVal))}" aria-label="${label}" title="${label}">${icon}</button>`;
}

function actionButtons(job: JobSnapshot): string {
  let out = '';
  // İndirme adresi HER durumda kopyalanabilir: sürerken (başka araca taşımak),
  // bittiğinde (paylaşmak), hata verdiğinde (elle denemek) — Nadir'in isteği.
  out += btn('copy', 'url', job.url, t('copyUrl'), icons.copy);
  if (job.state === 'downloading') out += btn('pause', 'id', job.id, t('pause'), icons.pause);
  else if (job.state === 'paused') out += btn('resume', 'id', job.id, t('resume'), icons.play);
  if (job.state === 'error' && !job.native) {
    out += btn('renew', 'id', job.id, t('renewT'), icons.refresh);
  }
  // native işler de artık downloads.onChanged üzerinden izleniyor (bulgu 5),
  // yani downloadId'leri var — Aç/Klasörde göster onlarda da çalışır.
  if (job.state === 'done' && job.downloadId !== undefined) {
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
    // Kuyruktaki iş sırasını göstersin — "Sırada · 2." bilinmezliği kaldırır
    setWord(ref, job.state === 'queued' && job.queuePos
      ? `${STATE_WORDS.queued} · ${job.queuePos}.`
      : STATE_WORDS[job.state]);
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
    // Teknik sebep (HTTP 403 gibi) başlığın yanında: "tüm bağlantılar düştü"
    // tek başına kullanıcıya da bize de yol göstermiyordu.
    ref.stats.textContent = [terr(job.error), job.errorDetail].filter(Boolean).join(' · ');
    ref.stats.title = job.url;
  } else if (job.state === 'done') {
    // Köken: ne zaman · nereden · kimden (hepsi yerel)
    const when = job.completedAt
      ? new Date(job.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';
    const from = job.origin ?? hostOf(job.url);
    ref.stats.textContent = [
      when, from, job.sender,
      job.digestOk ? `✓ ${t('verified')}` : '',
      job.digestSkipped ? `⚠ ${t('notVerified')}` : '',
      // "tarayıcıya devredildi" tek başına NEDENİ söylemiyordu; kullanıcı
      // hızlı inmediğini görüp bizde hata sanıyordu. Sebep sunucudadır:
      // Range desteklemeyen bir host'ta bölmek mümkün değil.
      job.native ? [t('wNative'), t('wNativeWhy'), job.errorDetail].filter(Boolean).join(' · ') : '',
      job.viaHelper ? t('wViaHelper') : '',
    ].filter(Boolean).join(' · ');
    ref.stats.title = job.url;
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
    // Birleştirilmiş (çakışmasız) aralıklar → her bucket'a kapladığı oran yazılır.
    const bucketSize = size / SEG_BUCKETS;
    for (const [rs, re] of job.ranges) {
      const s = bucketOf(rs);
      const e = bucketOf(re - 1);
      for (let b = s; b <= e; b++) {
        const bStart = b * bucketSize;
        const covered = Math.min(re, bStart + bucketSize) - Math.max(rs, bStart);
        fillPer[b] = Math.min(1, fillPer[b]! + covered / bucketSize);
      }
    }
    for (const c of job.claims) {
      if (c.a) activeSet.add(bucketOf(Math.min(size - 1, c.s + c.w)));
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

/**
 * "Tamamlanan" kartlarının sırası.
 *
 * SAHA HATASI (Nadir, 2026-08-24): "En son indirilen en üstte olmalı ama
 * karışık çıkıyor." Kartlar bir kez `appendChild` ile listeye giriyor ve BİR
 * DAHA yerleşmiyordu; bir iş tamamlandığında listenin SONUNA ekleniyordu.
 * Sıra "tamamlanma zamanı" değil "hangi kart ne zaman taşındı" oluyordu.
 * Artık her render'da DOM sırası açıkça kuruluyor.
 *
 * Aktif liste sıralanmaz: oradaki sıra kuyruğun kendisidir (FIFO) — motorun
 * gönderdiği düzen anlamlıdır, ada göre karıştırmak "sıradaki iş hangisi"
 * bilgisini yok ederdi.
 */
function orderDone(list: JobSnapshot[], mode: SortMode): JobSnapshot[] {
  const key = (j: JobSnapshot): number => j.completedAt ?? 0;
  const name = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const out = [...list];
  switch (mode) {
    case 'date-asc': return out.sort((a, b) => key(a) - key(b));
    case 'name-asc': return out.sort((a, b) => name.compare(a.filename, b.filename));
    case 'name-desc': return out.sort((a, b) => name.compare(b.filename, a.filename));
    case 'size-desc': return out.sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
    case 'size-asc': return out.sort((a, b) => (a.size ?? 0) - (b.size ?? 0));
    default: return out.sort((a, b) => key(b) - key(a));
  }
}

/** Son motor anlık görüntüsü — sıralama değişince yeni mesaj beklemeden yeniden çiz. */
let lastJobs: JobSnapshot[] = [];

function render(jobsList: JobSnapshot[]): void {
  lastJobs = jobsList;
  const seen = new Set<string>();
  const activeJobs: JobSnapshot[] = [];
  const doneJobs: JobSnapshot[] = [];

  for (const job of jobsList) {
    seen.add(job.id);
    const ref = cards.get(job.id) ?? createCard(job);
    updateCard(ref, job);
    (job.state === 'done' ? doneJobs : activeJobs).push(job);
  }

  for (const [id, ref] of cards) {
    if (!seen.has(id)) {
      ref.el.remove();
      cards.delete(id);
    }
  }

  // DOM sırasını her seferinde kur. `append` var olan düğümü TAŞIR (kopyalamaz),
  // yani kart kimliği, odak ve süren animasyon korunur.
  for (const [list, ordered] of [[activeList, activeJobs], [doneList, orderDone(doneJobs, sortMode)]] as const) {
    for (const job of ordered) {
      const el = cards.get(job.id)?.el;
      if (el) list.appendChild(el);
    }
  }

  const active = activeJobs.length;
  const done = doneJobs.length;

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
  if (act === 'renew') {
    setRenewMode(btn.dataset['id']!);
    return;
  }
  if (act === 'copy') {
    const url = btn.dataset['url'];
    if (url) {
      void navigator.clipboard.writeText(url).then(() => {
        liveRegion.textContent = t('copiedUrl');
        // Görsel onay: ikon kısa süre onaya döner — sessiz kopyalama "çalıştı mı?"
        // sorusu bıraktırır.
        const prev = btn.innerHTML;
        btn.innerHTML = icons.check;
        setTimeout(() => { btn.innerHTML = prev; }, 1500);
      }).catch(() => undefined);
    }
    return;
  }
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
  // helper-result artık ayarlar sayfasında ele alınıyor (src/options/).
});

send({ target: 'sw', type: 'hello-panel' });
