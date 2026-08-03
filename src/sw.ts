/**
 * Service Worker — sadece yönlendirici. Motor offscreen'de yaşar (PRD parça 1).
 */
import { BEAM_ALARM, loadState, pollOnce, saveState } from './beam/client';
import { matchShareLink } from './content/patterns';
import { DEFAULT_CATEGORY_NAMES, routeByType } from './engine/foldering';
import { decideTakeover } from './engine/takeover';
import { addEntry, type HistoryEntry } from './engine/history';
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

// Tarayıcı açılışında eşleşme varsa Beam yoklamasını yeniden kur
void loadState().then((s) => {
  if (s.pairing) void chrome.alarms.create(BEAM_ALARM, { periodInMinutes: 1 });
});

// ── Ayarlar (chrome.storage.local; UI panelde) ───────────────────────────────
const settings = {
  takeover: true,
  takeoverMinMB: 10,
  typeFolders: true,
  defaultExperience: false, // Chrome'un indirme balonunu gizle → Ruu varsayılan UI
  maxRetries: 1,
  queueLimit: 0, // 0 = sınırsız; kuyruk tamamen eklenti içinde çalışır

  notifyMode: 'notify' as 'silent' | 'notify' | 'party' | 'tab',
  partyUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  openWhenDone: false,
};

/** Offscreen'de chrome.storage yok — motoru ilgilendiren ayarlar mesajla itilir. */
function pushEngineSettings(): void {
  void chrome.runtime.sendMessage({
    target: 'engine', type: 'settings', maxRetries: settings.maxRetries,
    queueLimit: settings.queueLimit,
  } satisfies Msg).catch(() => undefined);
}

/** Chrome'un kendi indirme arayüzünü aç/kapat (downloads.ui izni). */
function applyDownloadUi(): void {
  const api = chrome.downloads as typeof chrome.downloads & {
    setUiOptions?: (o: { enabled: boolean }) => Promise<void>;
  };
  void api.setUiOptions?.({ enabled: !settings.defaultExperience }).catch(() => undefined);
}

/**
 * Ayarlar diskten gelene kadar bekleyen söz.
 *
 * MV3 tuzağı: SW'yi UYANDIRAN olayın kendisi (örn. downloads.onCreated) bu
 * promise çözülmeden dispatch edilebilir. O anda `settings` hâlâ varsayılan
 * olur — kullanıcı devralmayı KAPATMIŞ olsa bile indirme devralınır ve
 * iptal+erase edilir. Bu yüzden karar veren her yol önce bunu bekler.
 */
const settingsReady = chrome.storage.local.get(settings).then((s) => {
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

/** Paylaşım akışından gelen köken bilgisi (kısa ömürlü). */
let pendingOrigin: { name: string; sender?: string; until: number } | null = null;
function takeOrigin(): { origin?: string; sender?: string } {
  if (!pendingOrigin || Date.now() > pendingOrigin.until) return {};
  return { origin: pendingOrigin.name, sender: pendingOrigin.sender };
}

/** Teşhis: son devralma kararları — "neden devralmadı?" her zaman cevaplı. */
async function logTakeover(entry: Record<string, unknown>): Promise<void> {
  const cur = (await chrome.storage.local.get({ takeoverLog: [] }))['takeoverLog'] as unknown[];
  cur.unshift({ ...entry, t: Date.now() });
  await chrome.storage.local.set({ takeoverLog: cur.slice(0, 8) });
}

chrome.downloads.onCreated.addListener((item) => {
  void (async () => {
    // Kullanıcının GERÇEK ayarları yüklenmeden devralma kararı verilemez
    // (soğuk açılışta bu olay SW'yi uyandıran olayın ta kendisi olabilir).
    await settingsReady;
    // Paylaşım akışı açıksa kullanıcı zaten "Ruu ile indir" dedi → eşiği atla
    const decision = decideTakeover(item, settings, isOwn, shareTabs.size > 0);
    const shortUrl = decision.url.length > 72 ? `${decision.url.slice(0, 69)}…` : decision.url;
    if (decision.action === 'skip') {
      if (decision.reason !== 'own') {
        void logTakeover({ url: shortUrl, action: decision.reason, size: item.totalBytes });
      }
      // Devralmasak bile indirme BAŞLADI — paylaşım sekmesi işini bitirdi
      if (decision.reason !== 'own') closeShareTabsAfterDownload();
      return;
    }
    // SIRA ÖNEMLİ: önce motoru hazırla, SONRA Chrome'un indirmesini iptal et.
    // Tersi ("önce yık, sonra kur") motor hazırlığı patlarsa geri dönüşsüz:
    // indirme Chrome'dan silinmiş, Ruu'da da hiç başlamamış olur — kullanıcı
    // için dosya sessizce buharlaşır.
    try {
      await ensureOffscreen();
    } catch {
      void logTakeover({ url: shortUrl, action: 'engine-failed', size: item.totalBytes });
      return; // motor yok → dokunma, native indirme devam etsin
    }
    try {
      await chrome.downloads.cancel(item.id);
      await chrome.downloads.erase({ id: item.id });
    } catch {
      void logTakeover({ url: shortUrl, action: 'cancel-failed', size: item.totalBytes });
      return; // iptal edemedik → dokunma, native devam etsin
    }
    void logTakeover({ url: shortUrl, action: 'taken', size: item.totalBytes });
    closeShareTabsAfterDownload();
    const hint = item.filename ? item.filename.split(/[\\/]/).pop() : undefined;
    void chrome.runtime.sendMessage({
      target: 'engine', type: 'add', url: decision.url, filenameHint: hint,
      ...takeOrigin(),
    } satisfies Msg).catch(() => undefined);
  })();
});

/**
 * Offscreen belge oluşturma — TEK UÇUŞTA bir kez.
 *
 * Eski hali getContexts() ile createDocument() arasında async boşluk
 * bırakıyordu: iki eşzamanlı çağrı (iki hızlı indirme, beam yoklaması +
 * devralma) o boşlukta iç içe geçince ikinci createDocument
 * "Only a single offscreen document may be created" ile REDDEDİYORDU.
 * Çağıran taraf reddi yutunca indirme sessizce düşüyordu.
 */
let offscreenInflight: Promise<void> | null = null;

async function createOffscreen(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
  });
  if (contexts.length === 0) {
    try {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['BLOBS', 'WORKERS'] as chrome.offscreen.Reason[],
        justification:
          'Hosts the segmented download engine and OPFS disk worker so active transfers ' +
          'survive service worker suspension; creates blob URLs to hand completed files ' +
          'to the downloads API.',
      });
    } catch (err) {
      // Başka bir yol bizden önce oluşturduysa hedefe zaten ulaşıldı.
      if (!String(err).includes('single offscreen document')) throw err;
    }
  }
  await settingsReady;
  pushEngineSettings();
}

function ensureOffscreen(): Promise<void> {
  offscreenInflight ??= createOffscreen().finally(() => { offscreenInflight = null; });
  return offscreenInflight;
}

interface Delivery {
  jobId: string; size: number; topSpeed: number; priv: boolean;
  origin?: string; sender?: string;
  /** Native indiriciye düşülen iş — blob teslimi değil, ham URL. */
  native?: boolean;
}

/**
 * chrome downloadId → teslim bilgisi. **storage.session'da tutulur.**
 *
 * Neden bellekte değil: `downloads.download()` çağrısı ile `state:'complete'`
 * olayı arasında Chrome büyük dosyayı diske kopyalar; bu sırada
 * `downloads.onChanged` bayt ilerlemesi için TETİKLENMEZ. Başka aktif iş
 * yoksa SW 30 sn'de askıya alınır ve bellekteki map buharlaşırdı. Sonuç:
 *   • motor 'delivered' mesajını hiç almaz → iş sonsuza kadar 'finalizing'
 *   • keepAwake hiç bırakılmaz → kullanıcının bilgisayarı bir daha uyumaz
 *   • OPFS'teki (belki GB'larca) veri hiç silinmez
 *   • geçmiş/istatistik/bildirim hiç çalışmaz
 * storage.session tam bu iş için: SW askıya alınmasını aşar, tarayıcı
 * kapanınca temizlenir (kalıcı çöp bırakmaz).
 */
const DELIVERIES_KEY = 'deliveries';

/**
 * Teslim kaydı güncellemeleri SIRAYA SOKULUR.
 *
 * storage üzerinde oku-değiştir-yaz yapıyoruz; iki eşzamanlı teslim
 * (iki dosya aynı anda bitiyor) kilitsiz halde birbirini eziyordu: ikisi de
 * aynı nesneyi okur, her biri kendi anahtarını ekler, ikinci yazma birincinin
 * kaydını siler. Kaydı silinen iş 'delivered' haberini hiç alamaz ve sonsuza
 * kadar 'finalizing'de kalır. (E2E S14 tam bunu yakaladı.)
 */
let deliveryQueue: Promise<unknown> = Promise.resolve();

function withDeliveries<T>(fn: (all: Record<string, Delivery>) => T | Promise<T>): Promise<T> {
  const next = deliveryQueue.then(async () => {
    const all = ((await chrome.storage.session.get(DELIVERIES_KEY))[DELIVERIES_KEY] ?? {}) as
      Record<string, Delivery>;
    const out = await fn(all);
    await chrome.storage.session.set({ [DELIVERIES_KEY]: all });
    return out;
  });
  // Kuyruk bir hatayla kilitlenmesin
  deliveryQueue = next.catch(() => undefined);
  return next;
}

const getDelivery = (id: number): Promise<Delivery | undefined> =>
  withDeliveries((all) => all[String(id)]);

const setDelivery = (id: number, d: Delivery): Promise<void> =>
  withDeliveries((all) => { all[String(id)] = d; });

const dropDelivery = (id: number): Promise<void> =>
  withDeliveries((all) => { delete all[String(id)]; });

/** Kalıcı geçmiş — gizli indirmeler ASLA yazılmaz. */
async function recordHistory(id: number, d: Delivery, filename: string): Promise<void> {
  if (d.priv) return;
  const cur = (await chrome.storage.local.get({ history: [] }))['history'] as HistoryEntry[];
  await chrome.storage.local.set({
    history: addEntry(cur, {
      id, name: filename.split(/[\\/]/).pop() ?? '', size: d.size,
      at: Date.now(), origin: d.origin, sender: d.sender,
    }),
  });
}

async function recordStats(size: number, topSpeed: number): Promise<void> {
  const cur = (await chrome.storage.local.get({ stats: EMPTY_STATS }))['stats'] as Stats;
  await chrome.storage.local.set({ stats: applyDownload(cur, size, topSpeed) });
}

function celebrate(downloadId: number, filename = '', size = 0): void {
  switch (settings.notifyMode) {
    case 'tab': {
      const base = filename.split(/[\\/]/).pop() ?? '';
      void chrome.tabs.create({
        url: `done.html?id=${downloadId}&n=${encodeURIComponent(base)}&s=${size}`,
        active: true,
      }).catch(() => undefined);
      break;
    }
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
  // Teşhis işareti: enjeksiyon gerçekten oldu mu? (aynı belgeye iki kez kurma)
  const w = window as unknown as { __ruuAgent?: number };
  if (w.__ruuAgent) return;
  w.__ruuAgent = Date.now();
  // DİKKAT: kalıplar NORMALLEŞTİRİLMİŞ metinle eşleşir — JS'te /indir/i Türkçe
  // "İndir"i eşleştirmez (U+0130 → "i"+U+0307). Saha bug'ı, testli.
  const PATTERNS = /(tumunu indir|hepsini indir|yine de indir|indirmeyi baslat|indir|download all|download anyway|download all files|get your files|download|onayliyorum|onayla|kabul ediyorum|tumunu kabul et|kabul et|kabul|accept all|accept|i agree|agree|continue|devam et|devam)/;
  const EXPIRED = /(link.{0,12}(suresi doldu|expired|no longer)|suresi (dolmus|doldu)|artik (kullanilamaz|mevcut degil)|transfer.{0,12}(expired|deleted)|no longer available|not found|bulunamadi|silinmis)/;
  const norm = (s: string): string =>
    s.replace(/ı/g, 'i').replace(/İ/g, 'I')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  // DİKKAT: tekilleştirme ELEMENT bazlı olmalı — gerçek sayfalarda AYNI metinli
  // birden fazla onay düğmesi olabiliyor (Lifebox'ta iki "Onaylıyorum"); metne
  // göre tekilleştirmek ikinci onayı atlayıp akışı kilitliyordu.
  const clicked = new WeakSet<HTMLElement>();
  let clicks = 0;
  let ticks = 0;
  let expiredSent = false;
  const tick = (): void => {
    ticks++;
    try {
      // Süresi dolmuş / silinmiş paylaşım: tıklamaya çalışmak yerine kullanıcıyı uyar
      if (!expiredSent && ticks >= 2) {
        const body = norm((document.body?.innerText ?? '').slice(0, 2500));
        if (EXPIRED.test(body)) {
          expiredSent = true;
          try {
            void chrome.runtime.sendMessage({ target: 'sw', type: 'share-expired' }).catch(() => undefined);
          } catch { /* context yenilendi */ }
          return; // döngüyü durdur — tıklanacak bir şey yok
        }
      }
      // DİKKAT: bazı siteler indirme düğmesini href="#" olan <a> ile yapıyor
      // (Filebin "Download files") — seçici dar tutulunca hiç aday bulunmuyordu.
      // Güvenlik metin kalıbından gelir, seçiciden değil.
      const els = [
        ...document.querySelectorAll<HTMLElement>('button, a, [role="button"], [class*="download"]'),
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
      // SON ÇARE (5. turdan sonra): aksiyon düğmesi işe yaramadıysa sayfadaki
      // doğrudan dosya bağlantısını dene. Filebin gibi sitelerde indirme
      // "Download files" menüsü açıyor, asıl link dosya listesinde duruyor.
      if (ticks >= 5 && clicks < 2) {
        const FILE_EXT = /\.(zip|rar|7z|tar|gz|bin|iso|dmg|pkg|exe|msi|apk|pdf|mp4|mkv|mp3|epub|docx?|xlsx?|pptx?)(\?|$)/i;
        const link = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
          .find((a) => !clicked.has(a) && (a.hasAttribute('download') || FILE_EXT.test(a.href)));
        if (link) {
          clicked.add(link);
          clicks++;
          link.click();
          try {
            void chrome.runtime.sendMessage({
              target: 'sw', type: 'share-clicked', label: `dosya: ${link.href.split('/').pop()?.slice(0, 30)}`,
            }).catch(() => undefined);
          } catch { /* context yenilendi */ }
        }
      }
    } catch { /* sayfa DOM'u değişebilir; döngü ölmemeli */ }
    // ZORUNLU: bir sonraki tur HER DURUMDA planlanır (tıklama hatası akışı öldürmesin)
    if (ticks < 14 && clicks < 6) setTimeout(tick, 1200);
  };
  setTimeout(tick, 900);
}

/**
 * Açık paylaşım pencereleri: tabId → {reqId, mailTabId, windowId}.
 * KRİTİK BULGU: arka plan SEKMESİNDE modern SPA'lar render EDİLMEZ (Chrome
 * görünmeyen sekmede rAF'ı durdurur) — WeTransfer sayfasında hiç buton
 * oluşmuyordu. Odaklanmamış küçük POPUP PENCERE ise normal render ediyor
 * (sahada ölçüldü: 0 buton → 64 buton). Kullanıcının sekmesi de çalınmaz.
 */
const shareTabs = new Map<number, { reqId?: string; mailTabId?: number; windowId?: number }>();

function closeShareTab(tabId: number, windowId?: number): void {
  if (windowId !== undefined) void chrome.windows.remove(windowId).catch(() => undefined);
  else void chrome.tabs.remove(tabId).catch(() => undefined);
}

function notifyMail(
  info: { reqId?: string; mailTabId?: number; windowId?: number } | undefined,
  state: 'working' | 'started' | 'expired' | 'noaction',
): void {
  if (!info?.reqId || info.mailTabId === undefined) return;
  void chrome.tabs.sendMessage(info.mailTabId, {
    target: 'mail', type: 'share-status', reqId: info.reqId, state,
  }).catch(() => undefined);
}

async function handleShareFetch(
  rawUrl: string,
  ctx: { reqId?: string; mailTabId?: number; sender?: string } = {},
): Promise<void> {
  const match = matchShareLink(rawUrl);
  if (!match) return;
  if (match.kind === 'unaccel') {
    // Dürüstlük: uçtan uca şifreli / oturum duvarlı servislerde hızlandırma
    // TEKNİK OLARAK mümkün değil. Sayfayı açıp kullanıcıya sebebini söyleriz.
    void chrome.notifications.create({
      type: 'basic', iconUrl: 'icons/icon128.png',
      title: match.name,
      message: t(match.reason === 'e2ee' ? 'unaccelE2ee' : 'unaccelLogin'),
    }).catch(() => undefined);
    void logTakeover({ url: match.name, action: 'unaccel', size: -1 });
    void chrome.tabs.create({ url: match.url, active: true }).catch(() => undefined);
    return;
  }
  if (match.kind === 'direct') {
    // Tier 1: dönüştürülmüş URL doğrudan motora
    markOwn(match.url);
    await ensureOffscreen();
    void chrome.runtime.sendMessage({
      target: 'engine', type: 'add', url: match.url,
      origin: match.name, sender: ctx.sender,
    } satisfies Msg).catch(() => undefined);
    void logTakeover({ url: match.url.slice(0, 72), action: 'taken', size: -1 });
    return;
  }
  // Tier 3: paylaşım sayfasını arka planda aç + ajanı enjekte et; sitenin
  // başlattığı indirmeyi devralma yakalar. YALNIZCA tanınan servislerde.
  const win = await chrome.windows.create({
    url: match.url, type: 'popup', focused: false, width: 520, height: 420,
  }).catch(() => undefined);
  const tabId = win?.tabs?.[0]?.id;
  if (win === undefined || tabId === undefined) return;
  // KRİTİK: sekme HENÜZ about:blank olabilir — oraya enjekte edilen ajan,
  // gerçek sayfa yüklenince yok olur (E2E'de yakalandı). Bu yüzden 'complete'
  // beklenir; sonraki 'complete'lerde de yeniden enjekte edilir (SPA/redirect).
  shareTabs.set(tabId, { ...ctx, windowId: win.id });
  // Devralma sırasında köken bilgisi eklenebilsin diye servis adı hatırlanır
  pendingOrigin = { name: match.name, sender: ctx.sender, until: Date.now() + 120_000 };
  // DİKKAT: allFrames:true TEK çağrıda, erişilemeyen bir alt çerçeve yüzünden
  // TÜM enjeksiyonu reject edebiliyor (WeTransfer'de 5 iframe var; ana belgeye
  // hiç enjekte olmuyordu). Bu yüzden ana çerçeve ve alt çerçeveler AYRI çağrılır.
  const inject = (): void => {
    void chrome.scripting.executeScript({
      target: { tabId }, func: shareFlowAgent,
    }).catch(() => undefined);
    void chrome.scripting.executeScript({
      target: { tabId, allFrames: true }, func: shareFlowAgent,
    }).catch(() => undefined);
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
  // Emniyet ağı: indirme hiç başlamazsa sekme 1 dk sonra kapanır (alarm SW ölse
  // de uyanır). Normalde indirme başlar başlamaz kapatılır — aşağıda.
  void chrome.alarms.create(`ruu-share-close-${tabId}`, { delayInMinutes: 1 });
}

/**
 * Beam yoklaması — MV3'te uzun bekleme YAPILAMAZ, bu yüzden alarm kullanılır
 * (alarm SW'yi uyandırır; setTimeout uyandırmaz).
 */
async function beamPoll(): Promise<void> {
  const state = await loadState();
  if (!state.pairing) return;
  const urls = await pollOnce(state);
  await saveState(state);
  if (urls.length === 0) return;
  await ensureOffscreen();
  for (const url of urls) {
    markOwn(url);
    void chrome.runtime.sendMessage({
      target: 'engine', type: 'add', url, origin: 'Ruu Beam',
    } satisfies Msg).catch(() => undefined);
  }
  void chrome.notifications.create({
    type: 'basic', iconUrl: 'icons/icon128.png',
    title: 'Ruu Beam', message: `${urls.length} bağlantı alındı`,
  }).catch(() => undefined);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BEAM_ALARM) { void beamPoll(); return; }
  const m = alarm.name.match(/^ruu-share-close-(\d+)$/);
  if (!m) return;
  const tabId = Number(m[1]);
  const info = shareTabs.get(tabId);
  if (info) {
    notifyMail(info, 'noaction'); // hiç indirme başlamadı — kullanıcı bilsin
    shareTabs.delete(tabId);
  }
  closeShareTab(tabId, info?.windowId);
});

/** İndirme başladı: paylaşım sekmelerini kapat, mail düğmesini yeşile çevir. */
function closeShareTabsAfterDownload(): void {
  if (shareTabs.size === 0) return;
  for (const [tabId, info] of shareTabs) {
    notifyMail(info, 'started');
    void chrome.alarms.clear(`ruu-share-close-${tabId}`);
    setTimeout(() => closeShareTab(tabId, info.windowId), 1200);
  }
  shareTabs.clear();
}

chrome.notifications.onButtonClicked.addListener((notificationId) => {
  const m = notificationId.match(/^ruu-dl-(\d+)$/);
  if (m) {
    try { chrome.downloads.open(Number(m[1])); } catch { /* dosya taşınmış olabilir */ }
  }
});

chrome.runtime.onMessage.addListener((raw: Msg, sender) => {
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
        await handleShareFetch(raw.url, { reqId: raw.reqId, mailTabId: sender.tab?.id, sender: raw.sender });
        break;
      }
      case 'share-clicked': {
        void logTakeover({ url: raw.label, action: 'share-auto', size: -1 });
        break;
      }
      case 'share-expired': {
        const tabId = sender.tab?.id;
        if (tabId !== undefined) {
          const info = shareTabs.get(tabId);
          notifyMail(info, 'expired');
          shareTabs.delete(tabId);
          void chrome.alarms.clear(`ruu-share-close-${tabId}`);
          void chrome.notifications.create({
            type: 'basic', iconUrl: 'icons/icon128.png',
            title: 'Ruu', message: t('shExpired'),
          }).catch(() => undefined);
          // Süresi dolmuş: pencereyi kapat — bildirim + mail düğmesi zaten uyarıyor
          closeShareTab(tabId, info?.windowId);
        }
        break;
      }
      case 'beam-pair': {
        const state = await loadState();
        await saveState({ ...state, pairing: raw.pairing, seen: [] });
        // 1 dk periyot: MV3 alarm alt sınırı 30 sn; 1 dk hem güvenli hem yeterli
        await chrome.alarms.create(BEAM_ALARM, { periodInMinutes: 1 });
        void beamPoll();
        break;
      }
      case 'beam-unpair': {
        await chrome.storage.local.set({ beam: { seen: [] } });
        await chrome.alarms.clear(BEAM_ALARM);
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
          await setDelivery(id, {
            jobId: raw.jobId, size: raw.size, topSpeed: raw.topSpeed,
            priv: raw.priv ?? false, origin: raw.origin, sender: raw.sender,
          });
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
        // Sonucu İZLEMEK zorundayız: eskiden hata yutuluyordu ve motor işi
        // 'done' sayıyordu — süresi dolmuş bir linkte kullanıcı yeşil
        // "Tamamlandı" kartı görüp dosyanın indiğini sanıyordu.
        try {
          const id = await chrome.downloads.download({ url: raw.url });
          await setDelivery(id, {
            jobId: raw.jobId, size: 0, topSpeed: 0, priv: false, native: true,
          });
        } catch (err) {
          void chrome.runtime.sendMessage({
            target: 'engine', type: 'delivered', jobId: raw.jobId,
            ok: false, error: err instanceof Error ? err.message : String(err),
          } satisfies Msg).catch(() => undefined);
        }
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
  void (async () => {
  const delivery = await getDelivery(delta.id);
  if (!delivery) return;
  // Safe Browsing teslim yolumuzu DA tarar (Chromium: blob: şeması bilinçli
  // olarak whitelist'te). Tehlikeli bulunursa indirme askıya alınır —
  // sessizce takılı kalmasın, kullanıcıya söyle.
  const danger = delta.danger?.current;
  if (danger && danger !== 'safe' && danger !== 'accepted') {
    await dropDelivery(delta.id);
    void chrome.runtime.sendMessage({
      target: 'engine', type: 'delivered', jobId: delivery.jobId,
      ok: false, error: 'errBlocked',
    } satisfies Msg).catch(() => undefined);
    void chrome.notifications.create({
      type: 'basic', iconUrl: 'icons/icon128.png',
      title: 'Ruu', message: t('errBlocked'),
    }).catch(() => undefined);
    return;
  }
  if (delta.state?.current === 'complete') {
    await dropDelivery(delta.id);
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
      void chrome.downloads.search({ id: delta.id }).then((items) => {
        const filename = items[0]?.filename ?? '';
        void recordHistory(delta.id, delivery, filename);
        celebrate(delta.id, filename, delivery.size);
      }).catch(() => celebrate(delta.id, '', delivery.size));
    }
  } else if (delta.state?.current === 'interrupted') {
    await dropDelivery(delta.id);
    void chrome.runtime.sendMessage({
      target: 'engine', type: 'delivered', jobId: delivery.jobId, ok: false,
      error: delta.error?.current ?? 'interrupted',
    } satisfies Msg).catch(() => undefined);
  }
  })();
});
