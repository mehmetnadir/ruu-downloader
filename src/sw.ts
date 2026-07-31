/**
 * Service Worker — sadece yönlendirici. Motor offscreen'de yaşar (PRD parça 1).
 */
import { matchShareLink } from './content/patterns';
import { DEFAULT_CATEGORY_NAMES, routeByType } from './engine/foldering';
import { decideTakeover } from './engine/takeover';
import { applyDownload, EMPTY_STATS, type Stats } from './engine/stats';
import type { Msg } from './engine/types';

const t = (key: string): string => chrome.i18n.getMessage(key) || key;

/** Yerelleştirilmiş klasör kategori adları (catImg → "Görseller" vb.). */
const CATEGORY_NAMES: Record<string, string> = Object.fromEntries(
  Object.keys(DEFAULT_CATEGORY_NAMES).map((k) => [k, t(k)]),
);

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// ── Ayarlar (chrome.storage.local; UI panelde) ───────────────────────────────
const settings = {
  takeover: true,
  takeoverMinMB: 10,
  typeFolders: true,
  defaultExperience: false, // Chrome'un indirme balonunu gizle → Ruu varsayılan UI
  maxRetries: 1,
  notifyMode: 'notify' as 'silent' | 'notify' | 'party',
  partyUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  openWhenDone: false,
};

/** Offscreen'de chrome.storage yok — motoru ilgilendiren ayarlar mesajla itilir. */
function pushEngineSettings(): void {
  void chrome.runtime.sendMessage({
    target: 'engine', type: 'settings', maxRetries: settings.maxRetries,
  } satisfies Msg).catch(() => undefined);
}

/** Chrome'un kendi indirme arayüzünü aç/kapat (downloads.ui izni). */
function applyDownloadUi(): void {
  const api = chrome.downloads as typeof chrome.downloads & {
    setUiOptions?: (o: { enabled: boolean }) => Promise<void>;
  };
  void api.setUiOptions?.({ enabled: !settings.defaultExperience }).catch(() => undefined);
}

void chrome.storage.local.get(settings).then((s) => {
  Object.assign(settings, s);
  applyDownloadUi();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const [k, v] of Object.entries(changes)) {
    if (k in settings) (settings as Record<string, unknown>)[k] = v.newValue;
  }
  if (changes['defaultExperience']) applyDownloadUi();
  if (changes['maxRetries']) pushEngineSettings();
});

// ── İndirme devralma (PRD F1) ────────────────────────────────────────────────
// Kendi başlattığımız indirmeler devralma döngüsüne girmesin (URL bazlı, 30 sn TTL).
const recentOwnUrls = new Map<string, number>();
function markOwn(url: string): void {
  recentOwnUrls.set(url, Date.now() + 30_000);
  if (recentOwnUrls.size > 100) {
    for (const [u, t] of recentOwnUrls) if (Date.now() > t) recentOwnUrls.delete(u);
  }
}
function isOwn(url: string): boolean {
  const t = recentOwnUrls.get(url);
  if (t === undefined) return false;
  if (Date.now() > t) { recentOwnUrls.delete(url); return false; }
  return true;
}

/** Teşhis: son devralma kararları — "neden devralmadı?" her zaman cevaplı. */
async function logTakeover(entry: Record<string, unknown>): Promise<void> {
  const cur = (await chrome.storage.local.get({ takeoverLog: [] }))['takeoverLog'] as unknown[];
  cur.unshift({ ...entry, t: Date.now() });
  await chrome.storage.local.set({ takeoverLog: cur.slice(0, 8) });
}

chrome.downloads.onCreated.addListener((item) => {
  void (async () => {
    const decision = decideTakeover(item, settings, isOwn);
    const shortUrl = decision.url.length > 72 ? `${decision.url.slice(0, 69)}…` : decision.url;
    if (decision.action === 'skip') {
      if (decision.reason !== 'own') {
        void logTakeover({ url: shortUrl, action: decision.reason, size: item.totalBytes });
      }
      return;
    }
    try {
      await chrome.downloads.cancel(item.id);
      await chrome.downloads.erase({ id: item.id });
    } catch {
      void logTakeover({ url: shortUrl, action: 'cancel-failed', size: item.totalBytes });
      return; // iptal edemedik → dokunma, native devam etsin
    }
    void logTakeover({ url: shortUrl, action: 'taken', size: item.totalBytes });
    const hint = item.filename ? item.filename.split(/[\\/]/).pop() : undefined;
    await ensureOffscreen();
    void chrome.runtime.sendMessage({
      target: 'engine', type: 'add', url: decision.url, filenameHint: hint,
    } satisfies Msg).catch(() => undefined);
  })();
});

async function ensureOffscreen(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
  });
  if (contexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['BLOBS', 'WORKERS'] as chrome.offscreen.Reason[],
    justification:
      'Hosts the segmented download engine and OPFS disk worker so active transfers ' +
      'survive service worker suspension; creates blob URLs to hand completed files ' +
      'to the downloads API.',
  });
  pushEngineSettings();
}

interface Delivery { jobId: string; size: number; topSpeed: number; priv: boolean }
const deliveries = new Map<number, Delivery>(); // chrome downloadId → teslim bilgisi

async function recordStats(size: number, topSpeed: number): Promise<void> {
  const cur = (await chrome.storage.local.get({ stats: EMPTY_STATS }))['stats'] as Stats;
  await chrome.storage.local.set({ stats: applyDownload(cur, size, topSpeed) });
}

function celebrate(downloadId: number): void {
  switch (settings.notifyMode) {
    case 'silent':
      break;
    case 'party':
      void chrome.tabs.create({ url: settings.partyUrl }).catch(() => undefined);
      break;
    case 'notify':
      void chrome.notifications.create(`ruu-dl-${downloadId}`, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: t('nTitle'),
        message: t('nMsg'),
        buttons: [{ title: t('nOpen') }],
      }).catch(() => undefined);
      break;
  }
  if (settings.openWhenDone) {
    // gesture gerektirebilir; olmadıysa bildirim/panel Aç butonu devrede
    try { chrome.downloads.open(downloadId); } catch { /* gesture yok */ }
  }
}

// ── Paylaşım linki çözümleme (mail entegrasyonu) ─────────────────────────────
/**
 * Sayfaya enjekte edilen otomasyon ajanı — TAMAMEN sayfa içinde çalışır.
 * KRİTİK (MV3): uzun bekleme SW'de YAPILAMAZ — setTimeout service worker'ı
 * ayakta tutmaz, iş sessizce ölür. Bu yüzden onay/indir bekleme döngüsü
 * sayfanın kendi zamanlayıcılarında yaşar; SW yalnızca sekmeyi açar ve ajanı
 * bir kez enjekte eder. Kapalı (closure'sız) olmak ZORUNDA — serialize edilir.
 */
function shareFlowAgent(): void {
  // DİKKAT: kalıplar NORMALLEŞTİRİLMİŞ metinle eşleşir — JS'te /indir/i Türkçe
  // "İndir"i eşleştirmez (U+0130 → "i"+U+0307). Saha bug'ı, testli.
  const PATTERNS = /(tumunu indir|hepsini indir|yine de indir|indirmeyi baslat|indir|download all|download anyway|download all files|get your files|download|onayliyorum|onayla|kabul ediyorum|tumunu kabul et|kabul et|kabul|accept all|accept|i agree|agree|continue|devam et|devam)/;
  const norm = (s: string): string =>
    s.replace(/ı/g, 'i').replace(/İ/g, 'I')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  // DİKKAT: tekilleştirme ELEMENT bazlı olmalı — gerçek sayfalarda AYNI metinli
  // birden fazla onay düğmesi olabiliyor (Lifebox'ta iki "Onaylıyorum"); metne
  // göre tekilleştirmek ikinci onayı atlayıp akışı kilitliyordu.
  const clicked = new WeakSet<HTMLElement>();
  let clicks = 0;
  let ticks = 0;
  const tick = (): void => {
    ticks++;
    try {
      const els = [
        ...document.querySelectorAll<HTMLElement>('button, a[download], a[href*="download"], [role="button"]'),
      ];
      for (const el of els) {
        const text = (el.textContent ?? '').trim();
        if (!text || text.length > 60 || el.offsetParent === null) continue;
        if (!PATTERNS.test(norm(text))) continue;
        if (clicked.has(el)) continue;
        clicked.add(el);
        clicks++;
        el.click();
        try {
          void chrome.runtime.sendMessage({
            target: 'sw', type: 'share-clicked', label: text.slice(0, 40),
          }).catch(() => undefined);
        } catch { /* extension context yenilendi — akış yine de sürer */ }
        break; // her turda tek tık — sayfa yeniden çizilsin
      }
    } catch { /* sayfa DOM'u değişebilir; döngü ölmemeli */ }
    // ZORUNLU: bir sonraki tur HER DURUMDA planlanır (tıklama hatası akışı öldürmesin)
    if (ticks < 14 && clicks < 6) setTimeout(tick, 1200);
  };
  setTimeout(tick, 900);
}

async function handleShareFetch(rawUrl: string): Promise<void> {
  const match = matchShareLink(rawUrl);
  if (!match) return;
  if (match.kind === 'direct') {
    // Tier 1: dönüştürülmüş URL doğrudan motora
    markOwn(match.url);
    await ensureOffscreen();
    void chrome.runtime.sendMessage({
      target: 'engine', type: 'add', url: match.url,
    } satisfies Msg).catch(() => undefined);
    void logTakeover({ url: match.url.slice(0, 72), action: 'taken', size: -1 });
    return;
  }
  // Tier 3: paylaşım sayfasını arka planda aç + ajanı enjekte et; sitenin
  // başlattığı indirmeyi devralma yakalar. YALNIZCA tanınan servislerde.
  const tab = await chrome.tabs.create({ url: match.url, active: false });
  const tabId = tab.id!;
  // KRİTİK: sekme HENÜZ about:blank olabilir — oraya enjekte edilen ajan,
  // gerçek sayfa yüklenince yok olur (E2E'de yakalandı). Bu yüzden 'complete'
  // beklenir; sonraki 'complete'lerde de yeniden enjekte edilir (SPA/redirect).
  const inject = (): void => {
    void chrome.scripting.executeScript({ target: { tabId }, func: shareFlowAgent })
      .catch(() => undefined);
  };
  let injections = 0;
  const onUpdated = (id: number, info: { status?: string }): void => {
    if (id !== tabId || info.status !== 'complete') return;
    if (++injections >= 3) chrome.tabs.onUpdated.removeListener(onUpdated);
    inject();
  };
  chrome.tabs.onUpdated.addListener(onUpdated);
  const current = await chrome.tabs.get(tabId).catch(() => null);
  if (current?.status === 'complete') inject();
  void logTakeover({ url: match.url.slice(0, 72), action: 'share-open', size: -1 });
  // Sekme temizliği alarm ile — SW ölse bile alarm onu uyandırır (setTimeout ölür).
  void chrome.alarms.create(`ruu-share-close-${tabId}`, { delayInMinutes: 0.5 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  const m = alarm.name.match(/^ruu-share-close-(\d+)$/);
  if (m) void chrome.tabs.remove(Number(m[1])).catch(() => undefined);
});

chrome.notifications.onButtonClicked.addListener((notificationId) => {
  const m = notificationId.match(/^ruu-dl-(\d+)$/);
  if (m) {
    try { chrome.downloads.open(Number(m[1])); } catch { /* dosya taşınmış olabilir */ }
  }
});

chrome.runtime.onMessage.addListener((raw: Msg) => {
  // İkon rozeti: motorun panel yayınlarını SW de dinler (kullanıcı acısı #4 —
  // "indirmeyi kaybediyorum"). Aktif iş sayısı ikonda görünür.
  if (raw.target === 'panel' && raw.type === 'jobs') {
    const active = raw.jobs.filter((j) =>
      j.state === 'downloading' || j.state === 'probing' || j.state === 'finalizing').length;
    void chrome.action.setBadgeText({ text: active ? String(active) : '' }).catch(() => undefined);
    void chrome.action.setBadgeBackgroundColor({ color: '#e8a33d' }).catch(() => undefined);
    return;
  }
  if (raw.target !== 'sw') return;
  void (async () => {
    switch (raw.type) {
      case 'add':
      case 'pause':
      case 'resume':
      case 'cancel':
      case 'renew':
      case 'pause-all': {
        await ensureOffscreen();
        void chrome.runtime.sendMessage({ ...raw, target: 'engine' }).catch(() => undefined);
        break;
      }
      case 'share-fetch': {
        await handleShareFetch(raw.url);
        break;
      }
      case 'share-clicked': {
        void logTakeover({ url: raw.label, action: 'share-auto', size: -1 });
        break;
      }
      case 'hello-panel': {
        await ensureOffscreen();
        void chrome.runtime.sendMessage({ target: 'engine', type: 'query' }).catch(() => undefined);
        break;
      }
      case 'deliver': {
        try {
          const id = await chrome.downloads.download({
            url: raw.blobUrl,
            filename: routeByType(raw.filename, settings.typeFolders, CATEGORY_NAMES),
            conflictAction: 'uniquify',
          });
          deliveries.set(id, { jobId: raw.jobId, size: raw.size, topSpeed: raw.topSpeed, priv: raw.priv ?? false });
        } catch (err) {
          void chrome.runtime.sendMessage({
            target: 'engine', type: 'delivered', jobId: raw.jobId,
            ok: false, error: err instanceof Error ? err.message : String(err),
          } satisfies Msg).catch(() => undefined);
        }
        break;
      }
      case 'native-fallback': {
        markOwn(raw.url); // devralma bunu tekrar yakalayıp döngü kurmasın
        await chrome.downloads.download({ url: raw.url }).catch(() => undefined);
        break;
      }
      case 'keepawake': {
        if (raw.on) chrome.power.requestKeepAwake('system');
        else chrome.power.releaseKeepAwake();
        break;
      }
    }
  })();
});

chrome.downloads.onChanged.addListener((delta) => {
  const delivery = deliveries.get(delta.id);
  if (!delivery) return;
  if (delta.state?.current === 'complete') {
    deliveries.delete(delta.id);
    if (delivery.priv) {
      // gizli: geçmiş kaydı silinir, istatistik/parti yok, panel Aç butonu almaz
      void chrome.downloads.erase({ id: delta.id }).catch(() => undefined);
      void chrome.runtime.sendMessage({
        target: 'engine', type: 'delivered', jobId: delivery.jobId, ok: true,
      } satisfies Msg).catch(() => undefined);
    } else {
      void chrome.runtime.sendMessage({
        target: 'engine', type: 'delivered', jobId: delivery.jobId, ok: true, downloadId: delta.id,
      } satisfies Msg).catch(() => undefined);
      void recordStats(delivery.size, delivery.topSpeed);
      celebrate(delta.id);
    }
  } else if (delta.state?.current === 'interrupted') {
    deliveries.delete(delta.id);
    void chrome.runtime.sendMessage({
      target: 'engine', type: 'delivered', jobId: delivery.jobId, ok: false,
      error: delta.error?.current ?? 'interrupted',
    } satisfies Msg).catch(() => undefined);
  }
});
