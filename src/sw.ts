/**
 * Service Worker — sadece yönlendirici. Motor offscreen'de yaşar (PRD parça 1).
 */
import type { Msg } from './engine/types';

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
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
            filename: raw.filename,
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
      iconUrl: 'icon.png',
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
