/**
 * Service Worker — sadece yönlendirici. Motor offscreen'de yaşar (PRD parça 1).
 */
import { routeByType } from './engine/foldering';
import type { Msg } from './engine/types';

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

chrome.downloads.onCreated.addListener((item) => {
  void (async () => {
    if (!settings.takeover) return;
    const url = item.finalUrl || item.url;
    if (!/^https?:/i.test(url)) return; // blob/data/file şemaları bizim teslimlerimiz
    if (isOwn(url)) return;
    if (item.state !== 'in_progress') return;
    const size = item.totalBytes ?? -1;
    if (size > 0 && size < settings.takeoverMinMB * 1024 * 1024) return; // küçükler native kalsın
    try {
      await chrome.downloads.cancel(item.id);
      await chrome.downloads.erase({ id: item.id });
    } catch {
      return; // iptal edemedik → dokunma, native devam etsin
    }
    const hint = item.filename ? item.filename.split(/[\\/]/).pop() : undefined;
    await ensureOffscreen();
    void chrome.runtime.sendMessage({
      target: 'engine', type: 'add', url, filenameHint: hint,
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

const deliveries = new Map<number, string>(); // chrome downloadId → jobId

chrome.runtime.onMessage.addListener((raw: Msg) => {
  if (raw.target !== 'sw') return;
  void (async () => {
    switch (raw.type) {
      case 'add':
      case 'pause':
      case 'resume':
      case 'cancel':
      case 'pause-all': {
        await ensureOffscreen();
        void chrome.runtime.sendMessage({ ...raw, target: 'engine' }).catch(() => undefined);
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
            filename: routeByType(raw.filename, settings.typeFolders),
            conflictAction: 'uniquify',
          });
          deliveries.set(id, raw.jobId);
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
  const jobId = deliveries.get(delta.id);
  if (!jobId) return;
  if (delta.state?.current === 'complete') {
    deliveries.delete(delta.id);
    void chrome.runtime.sendMessage({
      target: 'engine', type: 'delivered', jobId, ok: true,
    } satisfies Msg).catch(() => undefined);
    void chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Ruu — indirme tamam',
      message: 'Dosya Downloads klasörüne kaydedildi.',
    }).catch(() => undefined);
  } else if (delta.state?.current === 'interrupted') {
    deliveries.delete(delta.id);
    void chrome.runtime.sendMessage({
      target: 'engine', type: 'delivered', jobId, ok: false, error: delta.error?.current ?? 'interrupted',
    } satisfies Msg).catch(() => undefined);
  }
});
