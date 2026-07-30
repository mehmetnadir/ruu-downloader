import type { JobSnapshot, Msg } from '../engine/types';

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

const urlInput = $<HTMLInputElement>('#url-input');
const addBtn = $<HTMLButtonElement>('#add-btn');
const activeList = $('#active-list');
const doneList = $('#done-list');
const activeCount = $('#active-count');
const doneCount = $('#done-count');
const emptyHint = $('#empty-hint');

function send(msg: Msg): void {
  void chrome.runtime.sendMessage(msg).catch(() => undefined);
}

function addFromInput(): void {
  const url = urlInput.value.trim();
  if (!url) return;
  send({ target: 'sw', type: 'add', url, connections: 4 });
  urlInput.value = '';
}

addBtn.addEventListener('click', addFromInput);
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addFromInput(); });
$('#pause-all').addEventListener('click', () => send({ target: 'sw', type: 'pause-all' }));

function fmtBytes(n: number): string {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(2)} GB`;
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(0)} KB`;
  return `${n} B`;
}

function fmtEta(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  if (sec < 60) return `${Math.ceil(sec)}sn`;
  return `${Math.floor(sec / 60)}dk ${Math.ceil(sec % 60)}sn`;
}

const ICONS = {
  pause: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M8 5v14M16 5v14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M7 4.5l12 7.5-12 7.5z" fill="currentColor"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
};

function segbar(job: JobSnapshot): string {
  if (!job.size || job.claims.length === 0) return '';
  const parts: string[] = [];
  let cursor = 0;
  for (const c of job.claims) {
    if (c.s > cursor) {
      parts.push(`<div class="seg" style="width:${((c.s - cursor) / job.size) * 100}%"></div>`);
    }
    const done = (c.w / Math.max(1, c.e - c.s)) * 100;
    parts.push(
      `<div class="seg${c.a ? ' active' : ''}" style="width:${((c.e - c.s) / job.size) * 100}%;` +
      `background:linear-gradient(to right, var(--accent) ${done}%, transparent ${done}%)"></div>`,
    );
    cursor = c.e;
  }
  if (cursor < job.size) {
    parts.push(`<div class="seg" style="width:${((job.size - cursor) / job.size) * 100}%"></div>`);
  }
  return `<div class="segbar">${parts.join('')}</div>`;
}

function card(job: JobSnapshot): string {
  const pct = job.size ? Math.floor((job.downloaded / job.size) * 100) : 0;
  const eta = job.speed > 0 && job.size ? (job.size - job.downloaded) / job.speed : NaN;
  let stats: string;
  let buttons = '';
  switch (job.state) {
    case 'probing': stats = 'bağlanıyor…'; break;
    case 'downloading':
      stats = `${fmtBytes(job.speed)}/s · %${pct} · ${fmtEta(eta)}`;
      buttons = `<button class="icon-btn" data-act="pause" data-id="${job.id}" title="Duraklat">${ICONS.pause}</button>`;
      break;
    case 'paused':
      stats = `duraklatıldı · %${pct}`;
      buttons = `<button class="icon-btn" data-act="resume" data-id="${job.id}" title="Devam">${ICONS.play}</button>`;
      break;
    case 'finalizing': stats = 'diske teslim ediliyor…'; break;
    case 'done': stats = job.native ? 'tarayıcıya devredildi' : 'tamamlandı'; break;
    case 'error': stats = job.error ?? 'hata'; break;
  }
  if (job.state !== 'done') {
    buttons += `<button class="icon-btn" data-act="cancel" data-id="${job.id}" title="İptal">${ICONS.x}</button>`;
  }
  return `<div class="card ${job.state}">
    <div class="row1">
      <span class="fname" title="${job.url}">${escapeHtml(job.filename)}</span>
      <span class="fsize">${job.size ? fmtBytes(job.size) : ''}</span>
    </div>
    ${job.state === 'downloading' || job.state === 'paused' ? segbar(job) : ''}
    <div class="row2"><span class="stats">${stats}</span><span class="actions">${buttons}</span></div>
  </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function render(jobsList: JobSnapshot[]): void {
  const active = jobsList.filter((j) => j.state !== 'done');
  const done = jobsList.filter((j) => j.state === 'done');
  activeList.innerHTML = active.map(card).join('');
  doneList.innerHTML = done.map(card).join('');
  activeCount.textContent = active.length ? `(${active.length})` : '';
  doneCount.textContent = done.length ? `(${done.length})` : '';
  emptyHint.style.display = jobsList.length ? 'none' : '';
}

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
