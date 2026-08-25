/**
 * Service Worker — sadece yönlendirici. Motor offscreen'de yaşar (PRD parça 1).
 */
import { BEAM_ALARM, loadState, pollOnce, saveState } from './beam/client';
import { matchShareLink } from './content/patterns';
import { downloadsRelative, safeFallbackName } from './engine/filename';
import { HELPER_HOST, isValidHandshake, type HelperHandshake } from './engine/helper';
import { DEFAULT_CATEGORY_NAMES, routeByType } from './engine/foldering';
import { decideTakeover, preflightVerdict } from './engine/takeover';
import {
  nativeDownloadAttempts, pickNativeName, pruneNativeNames, type NativeNameMarks,
} from './engine/native';
import { BYPASS_TTL_MS, shouldBypass, type BypassMark } from './engine/bypass';
import { addEntry, type HistoryEntry } from './engine/history';
import {
  apiBody, apiUrl, parseWetransfer, pickDirectLink, readCsrfToken,
} from './engine/wetransfer';
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
  // Varsayılan KAPALI: kullanıcı aksini söylemedikçe dosya tam olarak
  // Chrome'un koyacağı yere iner. Açıksa Downloads/Ruu/<kategori>/ altına
  // yönlendirilir — bu bir ek özellik, varsayılan davranış değil.
  typeFolders: false,
  defaultExperience: false, // Chrome'un indirme balonunu gizle → Ruu varsayılan UI
  maxRetries: 1,
  queueLimit: 0, // 0 = sınırsız; kuyruk tamamen eklenti içinde çalışır
  useHelper: false, // isteğe bağlı yerel yardımcı — varsayılan KAPALI
  continueAfterClose: false, // yardımcı varsa: tarayıcı kapansa da sürsün
  // Cmd/Ctrl/Alt basılı tıklama = "bu linki tarayıcı indirsin" (Nadir'in isteği).
  // Kapatılırsa sayfalara enjekte edilen içerik betiği de KALDIRILIR — izin
  // yüzeyi kullanıcının seçimiyle küçülür, ayar sadece bir bayrak değildir.
  modifierBypass: true,

  notifyMode: 'notify' as 'silent' | 'notify' | 'party' | 'tab',
  partyUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  openWhenDone: false,
};

/** Motorun davranışını değiştiren ayarlar — değişince mesajla itilmek ZORUNDA. */
const ENGINE_SETTINGS = ['maxRetries', 'queueLimit', 'continueAfterClose'] as const;

/** Offscreen'de chrome.storage yok — motoru ilgilendiren ayarlar mesajla itilir. */
function pushEngineSettings(): void {
  void chrome.runtime.sendMessage({
    target: 'engine', type: 'settings', maxRetries: settings.maxRetries,
    queueLimit: settings.queueLimit, continueAfterClose: settings.continueAfterClose,
  } satisfies Msg).catch(() => undefined);
}

/** Panel "yardımcıyı kullan"ı açtığında izinleri ister ve yeniden yoklar. */
interface EnableResult { ok: boolean; needsInstall: boolean }

async function enableHelper(): Promise<EnableResult> {
  const granted = await chrome.permissions.request({
    permissions: ['nativeMessaging'],
  }).catch(() => false);
  // İzin reddedildi = kullanıcının kararı; kurulum önerme.
  if (!granted) return { ok: false, needsInstall: false };

  await chrome.storage.local.set({ useHelper: true });
  settings.useHelper = true;
  await pushHelper(true);
  // İzin var ama el sıkışma olmadı = program kurulu değil. Panelin kurulum
  // yolunu gösterebilmesi için bu ikisini AYIRMAK gerekiyor.
  return { ok: cachedHandshake !== null, needsInstall: cachedHandshake === null };
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
  void applyBypassScript();
  // İkon durum göstergesi: SW her uyanışta gerçek durumu yansıtmalı.
  if (settings.useHelper) void pushHelper();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const [k, v] of Object.entries(changes)) {
    if (k in settings) (settings as Record<string, unknown>)[k] = v.newValue;
  }
  if (changes['defaultExperience']) applyDownloadUi();
  // Motoru ilgilendiren HER ayar itilmeli. Eskiden yalnızca maxRetries
  // tetikliyordu: kuyruk sınırını değiştirmek motora hiç ulaşmıyordu ve
  // ayar sessizce etkisiz kalıyordu. Listeyi tek yerde tutuyoruz ki yeni bir
  // ayar eklendiğinde aynı sessiz hata tekrarlanmasın.
  if (ENGINE_SETTINGS.some((k) => k in changes)) pushEngineSettings();
  if (changes['useHelper']) void pushHelper(true);
  if (changes['modifierBypass']) void applyBypassScript();
});

/**
 * Tuş basılı tıklama işareti — "bu linki Ruu ALMASIN".
 *
 * storage.session'da tutulur, bellekte DEĞİL: tıklama ile `downloads.onCreated`
 * arasında SW uykuya dalabilir (MV3'te 30 sn boşta yeter). Bellekte tutulsaydı
 * işaret tam ihtiyaç anında buharlaşır, kullanıcı tuşa bastığı hâlde indirme
 * Ruu'ya düşerdi — sessiz ve tekrarlanabilir bir hayal kırıklığı.
 */
const BYPASS_KEY = 'bypassMark';

async function markBypass(url: string): Promise<void> {
  await chrome.storage.session.set({ [BYPASS_KEY]: { url, at: Date.now() } satisfies BypassMark });
}

async function takeBypass(item: { url: string; finalUrl?: string }): Promise<boolean> {
  const mark = (await chrome.storage.session.get(BYPASS_KEY))[BYPASS_KEY] as BypassMark | undefined;
  if (!shouldBypass(mark, item, Date.now())) {
    // Süresi geçmiş işareti temizle: sonraki indirmeye sarkmasın.
    if (mark && Date.now() - mark.at > BYPASS_TTL_MS) {
      await chrome.storage.session.remove(BYPASS_KEY);
    }
    return false;
  }
  // TEK KULLANIMLIK: bir tıklama bir indirmeyi devreder. Kalsaydı aynı tuşla
  // açılan sayfanın tetiklediği ikinci dosya da sessizce tarayıcıya giderdi.
  await chrome.storage.session.remove(BYPASS_KEY);
  return true;
}

/**
 * Tuş basılı tıklamayı yalnız sayfa bağlamı görebilir; içerik betiği bunun
 * için var. DİNAMİK kaydediyoruz (manifest'te sabit değil): ayar kapalıysa
 * betik hiçbir siteye enjekte EDİLMEZ. İzin minimalizmi bir vaat değil,
 * çalışan bir davranış olmalı.
 */
const BYPASS_SCRIPT_ID = 'ruu-bypass';

async function applyBypassScript(): Promise<void> {
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [BYPASS_SCRIPT_ID] })
    .catch(() => [] as chrome.scripting.RegisteredContentScript[]);
  if (settings.modifierBypass) {
    if (existing.length) return;
    await chrome.scripting.registerContentScripts([{
      id: BYPASS_SCRIPT_ID,
      js: ['bypass.js'],
      matches: ['http://*/*', 'https://*/*'],
      runAt: 'document_start',
      allFrames: true,
      persistAcrossSessions: true,
    }]).catch(() => undefined);
  } else if (existing.length) {
    await chrome.scripting.unregisterContentScripts({ ids: [BYPASS_SCRIPT_ID] })
      .catch(() => undefined);
  }
}

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

/**
 * Devralma bekleme odası: dosya adı henüz BELİRLENMEMİŞ indirmeler.
 *
 * SAHA HATASI (Nadir): "Her dosya için sor" açıkken Chrome kaydetme penceresi
 * açılıyor; biz onCreated ANINDA devralıp iptal ediyorduk. Kullanıcı pencerede
 * klasör + isim seçiyordu ama pencere ÇOKTAN İPTAL EDİLMİŞ indirmenindi —
 * seçim boşluğa gidiyor, dosya motorun ürettiği adla İndirilenler'e iniyordu.
 *
 * Doğru sıra: filename atanana kadar BEKLE (pencere onayı ya da otomatik
 * belirleme), sonra devral — kullanıcının seçtiği ad ve İndirilenler-altı
 * klasörü ZORUNLU ad olarak motora taşınır ve teslimde ikinci bir pencere
 * açılmaz (saveAs:false).
 */
const pendingTakeover = new Map<number, chrome.downloads.DownloadItem>();

chrome.downloads.onCreated.addListener((item) => {
  void (async () => {
    await settingsReady;
    // İşaret BURADA tüketilir, `attemptTakeover` ertelense bile: "sor" penceresi
    // açıkken kullanıcı dakikalarca düşünebilir ve 4 sn'lik pencere çoktan
    // kapanmış olur. Tuşa bastığı an okunmazsa karar kaybolur.
    const bypassed = settings.modifierBypass ? await takeBypass(item) : false;
    if (!bypassed && !item.filename) {
      // Ad henüz yok: "sor" penceresi açık olabilir. Kararı onChanged'a bırak.
      pendingTakeover.set(item.id, item);
      // Pencere iptalle kapanırsa onChanged 'interrupted' getirir → temizlenir.
      return;
    }
    await attemptTakeover(item, bypassed);
  })();
});

/**
 * Native indirmede kullanıcının seçtiği adı DAYATMA.
 *
 * E2E S21 BULGUSU: `downloads.download({ url, filename })` yetmiyor. Chromium'un
 * `net::GenerateFileName` sırası şudur: önce Content-Disposition, ancak o boşsa
 * eklentinin `suggested_name`'i. Yani sunucu ad dayattığında bizim (kullanıcının)
 * adımız sessizce eziliyor — testi yazmasaydık "düzelttik" diyip geçecektik.
 *
 * Tek gerçek üstünlük `downloads.onDeterminingFilename`: hedef belirlendikten
 * SONRA çalışır ve `suggest()` son sözü söyler.
 *
 * storage.session'da tutuluyor (bellekte değil): `download()` çağrısı ile olayın
 * dispatch'i arasında MV3 servis çalışanı uykuya dalabilir.
 */
const NATIVE_NAMES_KEY = 'nativeNames';

/**
 * Bekleyen işaret VAR MI ipucu. `onDeterminingFilename` HER indirmede çalışır;
 * her seferinde storage okumak için `true` döndürmek tüm indirmelere gereksiz
 * bir gecikme bindirirdi. Servis çalışanı yeni uyandıysa bilmiyoruz (true ile
 * başlar); ilk okumada storage boş çıkarsa bir daha async yola sapmayız.
 */
let maybeHasNativeNames = true;

const readNativeNames = async (): Promise<NativeNameMarks> =>
  ((await chrome.storage.session.get(NATIVE_NAMES_KEY))[NATIVE_NAMES_KEY] ?? {}) as NativeNameMarks;

async function rememberNativeName(url: string, filename: string): Promise<void> {
  const all = pruneNativeNames(await readNativeNames(), Date.now());
  all[url] = { name: filename, at: Date.now() };
  maybeHasNativeNames = true;
  await chrome.storage.session.set({ [NATIVE_NAMES_KEY]: all });
}

async function takeNativeName(item: chrome.downloads.DownloadItem): Promise<string | null> {
  const { name, rest } = pickNativeName(await readNativeNames(), item, Date.now());
  maybeHasNativeNames = Object.keys(rest).length > 0;
  await chrome.storage.session.set({ [NATIVE_NAMES_KEY]: rest });
  return name;
}

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (!maybeHasNativeNames) return; // hızlı yol: Chrome kendi kararını versin
  // `true` döndüğümüz an suggest() çağırmak ZORUNLU: çağırmazsak indirme
  // sonsuza kadar hedef bekler. Bu yüzden her yol suggest ile bitiyor.
  void (async () => {
    let picked: string | null = null;
    try { picked = await takeNativeName(item); } catch { picked = null; }
    try {
      if (picked) suggest({ filename: picked, conflictAction: 'uniquify' });
      else suggest();
    } catch { /* Chrome kararı çoktan vermiş olabilir */ }
  })();
  return true;
});

/**
 * Devralma ön-uçuşu: adres BİZE de açılıyor mu?
 *
 * SAHA KANITI (Nadir, 2026-08-24, WeTransfer): WeTransfer indirmeyi
 * `POST /api/v4/transfers/<id>/download` ile doğuruyor. Chrome'un DownloadItem'ı
 * o adresi taşır ama YÖNTEMİ taşımaz; biz devralınca aynı adrese GET atıyoruz
 * ve sunucu 404 dönüyor (canlı doğrulandı: GET api → 404, GET sayfa → 200).
 * Ardından native'e düşülüyor, Chrome da GET ile gidip hata gövdesini alıyor →
 * `SERVER_BAD_CONTENT`. Kullanıcının ÇALIŞAN indirmesi bizim yüzümüzden ölüyordu.
 *
 * Bu yüzden iptalden ÖNCE tek baytlık bir istek atıyoruz. Maliyet bir gidiş-dönüş;
 * karşılığı, yerine geçemeyeceğimiz bir indirmeyi asla yıkmamak.
 *
 * NOT: yalnız DEVRALMA yolunda çağrılır. Panelden elle eklenen adreste korunacak
 * bir native indirme yoktur; orada motorun kendi probe'u zaten tek otoritedir.
 */
const PREFLIGHT_TIMEOUT_MS = 6000;

async function preflight(url: string): Promise<{ ok: boolean; why: string }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PREFLIGHT_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: { Range: 'bytes=0-0' },
      credentials: 'include',
      cache: 'no-store',
      signal: ctl.signal,
    });
    // Gövdeyi hemen bırak: 1 bayt istedik ama bağlantıyı açık tutmayalım.
    r.body?.cancel().catch(() => undefined);
    return { ok: preflightVerdict(r.status) !== 'abort', why: `HTTP ${r.status}` };
  } catch (err) {
    const name = err instanceof Error ? err.name : 'fetch';
    return { ok: false, why: name === 'AbortError' ? 'timeout' : name };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ön-uçuş "bu adrese ulaşamıyoruz" dedikten SONRA son bir şans.
 *
 * v0.6.4'te doğru karar kenara çekilmekti: adresi yeniden isteyemiyorsak
 * ısrar etmek kullanıcının dosyasını öldürür. Ama artık elimizde bir şey daha
 * var — indirmenin YÖNLENDİREN sayfası. WeTransfer'de o sayfa tam olarak
 * `/downloads/<id>/<hash>`tir, yani çözücünün ihtiyacı olan her şey.
 *
 * SIRA DEĞİŞMEZ: önce yeni adresi AL, sonra onu ön-uçuştan geçir, ANCAK ondan
 * sonra Chrome'un indirmesini iptal et. Herhangi bir adım tutmazsa `false`
 * döner ve davranış v0.6.4 ile bire bir aynı kalır — bu yol hiçbir koşulda
 * çalışan bir indirmeyi eskisinden daha çok riske atmaz.
 */
async function rescueViaResolver(item: chrome.downloads.DownloadItem): Promise<string | null> {
  const ref = item.referrer;
  if (!ref || !/^https?:/i.test(ref)) return null;
  const match = matchShareLink(ref);
  if (!match?.resolver) return null;
  const direct = await runResolver({ resolver: match.resolver, url: ref });
  if (direct === null) return null;
  // KANIT ŞARTI: yeni adres gerçekten çekilebiliyor mu? Doğrulamadan iptal yok.
  const pf = await preflight(direct);
  if (!pf.ok) return null;
  trackResolved(direct, ref);
  return direct;
}

async function attemptTakeover(
  item: chrome.downloads.DownloadItem,
  bypassed = false,
): Promise<void> {
  {
    // Paylaşım akışı açıksa kullanıcı zaten "Ruu ile indir" dedi → eşiği atla
    const decision = decideTakeover(item, settings, isOwn, shareTabs.size > 0, bypassed);
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
    // ÖN-UÇUŞ — iptalden ÖNCE. Sıra burada hayat memat meselesi: aşağıdaki
    // cancel+erase geri alınamaz, adres bize kapalıysa dosya buharlaşır.
    const pf = await preflight(decision.url);
    let rescued: string | null = null;
    if (!pf.ok) {
      // Adres bize kapalı. Yönlendiren sayfa tanınan bir servisse, o servisin
      // API'sinden ÇEKİLEBİLİRLİĞİ KANITLANMIŞ yeni bir adres alabiliriz.
      rescued = await rescueViaResolver(item);
      if (rescued === null) {
        void logTakeover({ url: shortUrl, action: 'unfetchable', size: item.totalBytes, why: pf.why });
        closeShareTabsAfterDownload();
        return; // Chrome'un ÇALIŞAN indirmesine dokunma — dosyayı o getirsin
      }
    }
    try {
      await chrome.downloads.cancel(item.id);
      await chrome.downloads.erase({ id: item.id });
    } catch {
      void logTakeover({ url: shortUrl, action: 'cancel-failed', size: item.totalBytes });
      return; // iptal edemedik → dokunma, native devam etsin
    }
    void logTakeover({
      url: shortUrl, action: rescued ? 'rescued' : 'taken', size: item.totalBytes,
    });
    closeShareTabsAfterDownload();
    // Chrome'un belirlediği ad = kullanıcının seçimi (pencere açıldıysa) ya da
    // sitenin önerisi. İkisinde de bu ad ZORUNLUDUR — motorun probe'daki
    // Content-Disposition tahmini kullanıcı seçimini ezmemeli.
    const forcedName = item.filename ? downloadsRelative(item.filename) : undefined;
    const finalUrl = rescued ?? decision.url;
    if (rescued) markOwn(rescued);
    void chrome.runtime.sendMessage({
      target: 'engine', type: 'add', url: finalUrl, forcedName,
      ...takeOrigin(),
    } satisfies Msg).catch(() => undefined);
  }
}

chrome.downloads.onChanged.addListener((delta) => {
  const pending = pendingTakeover.get(delta.id);
  if (!pending) return;
  if (delta.state?.current === 'interrupted' || delta.error) {
    pendingTakeover.delete(delta.id); // pencere iptal edildi ya da indirme öldü
    return;
  }
  if (delta.filename?.current) {
    // Kullanıcı seçimini yaptı (ya da Chrome adı belirledi) — ŞİMDİ devral.
    pendingTakeover.delete(delta.id);
    void (async () => {
      await settingsReady;
      await attemptTakeover({ ...pending, filename: delta.filename!.current! });
    })();
  }
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
  void pushHelper();
}

// Yardımcı ayarı değişince önbellek geçersiz: kullanıcı az önce kurmuş olabilir.

function ensureOffscreen(): Promise<void> {
  offscreenInflight ??= createOffscreen().finally(() => { offscreenInflight = null; });
  return offscreenInflight;
}

/**
 * Yerel yardımcıyla el sıkışma.
 *
 * `connectNative` yalnızca yüklü manifest'te bizim eklenti kimliğimiz yazılıysa
 * çalışır; yardımcı port ve token'ı bu kanaldan verir. Kanal hemen kapanır —
 * veri trafiği HTTP'ye geçer, çünkü yardımcının varlık sebeplerinden biri
 * tarayıcı kapandıktan SONRA da sürmek ve o an bu kanal ölmüş olur.
 *
 * Yardımcı yoksa sessizce null döner. Kurulum önerisi/dırdırı YOK.
 */
async function helperHandshake(): Promise<HelperHandshake | null> {
  if (!settings.useHelper) return null;
  // Host izni GEREKMİYOR: yardımcı yalnızca bizim eklenti kaynağımıza CORS
  // izni veriyor (kaynağı Chrome native-messaging ile ona bildiriyor).
  // Bir izin daha az istemek, hem sürtünmeyi hem inceleme yüzeyini küçültür.
  const granted = await chrome.permissions.contains({
    permissions: ['nativeMessaging'],
  }).catch(() => false);
  if (!granted) return null;

  return new Promise((resolve) => {
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connectNative(HELPER_HOST);
    } catch {
      resolve(null);
      return;
    }
    const done = (v: HelperHandshake | null) => {
      try { port.disconnect(); } catch { /* zaten kapalı */ }
      resolve(v);
    };
    // Yardımcı kurulu değilse onDisconnect gelir; asılı kalmamak için süre sınırı.
    const timer = setTimeout(() => done(null), 4000);
    port.onMessage.addListener((msg) => {
      clearTimeout(timer);
      done(isValidHandshake(msg) ? msg : null);
    });
    port.onDisconnect.addListener(() => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

/**
 * Son başarılı el sıkışma. Önbelleklenir çünkü `ensureOffscreen()` HER indirmede
 * çağrılıyor ve her seferinde `connectNative` yapmak yardımcı süreciyle
 * gereksiz bir el sıkışma turu demek. Yardımcı ölürse HTTP çağrısı hata verir
 * ve motor kendi indirmesine döner; o noktada önbellek `invalidateHelper()`
 * ile temizlenir.
 */
let cachedHandshake: HelperHandshake | null = null;
let handshakeTried = false;
/** Son bilinen yardımcı durumu — ikon ve options bandı buna bakar. */
let helperUp = false;
let helperVersion = '';

const HELPER_ALARM = 'ruu-helper-health';

/**
 * Araç çubuğu ikonu = durum göstergesi.
 * Kahve tonları (amber zemin) → yalnız tarayıcı motoru.
 * Ters renk (koyu zemin, amber ok) → yerel yardımcı BAĞLI.
 * Kullanıcı panele bakmadan hangi motorun devrede olduğunu görür.
 */
function updateActionIcon(): void {
  const dir = helperUp ? 'icons/helper' : 'icons';
  void chrome.action.setIcon({
    path: { 16: `${dir}/icon16.png`, 48: `${dir}/icon48.png`, 128: `${dir}/icon128.png` },
  }).catch(() => undefined);
}

/**
 * Yardımcı sağlığını doğrular ve ikonu günceller.
 *
 * El sıkışma port+token verir ama sürecin ŞU AN yaşadığını kanıtlamaz —
 * kullanıcı programı kapatmış olabilir. Gerçek durum yalnızca /health'e
 * sorularak bilinir. Yardımcı ölmüşse el sıkışma önbelleği de temizlenir ki
 * bir sonraki deneme taze connectNative yapsın.
 */
async function refreshHelperStatus(): Promise<void> {
  const hs = cachedHandshake;
  if (!settings.useHelper || !hs) {
    helperUp = false; helperVersion = '';
    updateActionIcon();
    return;
  }
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3000);
    const res = await fetch(`http://127.0.0.1:${hs.port}/health`, {
      headers: { Authorization: `Bearer ${hs.token}` }, signal: ctl.signal,
    });
    clearTimeout(timer);
    const body = res.ok ? ((await res.json()) as { version?: string }) : null;
    helperUp = res.ok;
    helperVersion = body?.version ?? '';
  } catch {
    helperUp = false; helperVersion = '';
    invalidateHelper(); // süreç ölmüş — sonraki deneme taze el sıkışma yapsın
  }
  updateActionIcon();
}

function broadcastHelperState(): void {
  void chrome.runtime.sendMessage({
    target: 'panel', type: 'helper-state',
    enabled: settings.useHelper, up: helperUp,
    ...(helperVersion ? { version: helperVersion } : {}),
  } satisfies Msg).catch(() => undefined);
}

function invalidateHelper(): void {
  cachedHandshake = null;
  handshakeTried = false;
}

/** El sıkışmayı motora iter; yardımcı yoksa null gider ve motor kendi indirir. */
async function pushHelper(force = false): Promise<void> {
  if (force) invalidateHelper();
  if (!handshakeTried) {
    cachedHandshake = await helperHandshake();
    handshakeTried = true;
  }
  void chrome.runtime.sendMessage({
    target: 'engine', type: 'helper', handshake: cachedHandshake,
  } satisfies Msg).catch(() => undefined);
  await refreshHelperStatus();
  // İkon CANLI kalmalı: yardımcı kapatılırsa ters renk yalan söylemeye başlar.
  // 1 dk'lık alarm localhost'a tek GET — maliyeti önemsiz, dürüstlük değerli.
  if (settings.useHelper) {
    void chrome.alarms.create(HELPER_ALARM, { periodInMinutes: 1 });
  } else {
    void chrome.alarms.clear(HELPER_ALARM);
  }
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
        // İki eylem: dosyayı aç · klasörde göster (dosyanın NEREYE indiğini
        // görmek, açmak kadar sık istenen şey — özellikle "her seferinde sor"
        // kapalıyken kullanıcı konumu bilmiyor olabilir.)
        buttons: [{ title: t('nOpen') }, { title: t('showFolder') }],
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

/**
 * ── Servise özel çözücüler (PRD "Tier 2") ───────────────────────────────────
 *
 * Paylaşım sayfasını açıp sitenin indirmesini devralmak EVRENSEL ama en pahalı
 * yoldur: pencere açılır, sayfa yüklenir, buton aranır, indirme doğar, devralma
 * onu iptal eder. Servisin kendi API'si aynı sonucu tek POST ile veriyorsa o
 * yol hem hızlı hem kırılgan olmayan noktalarda duruyor.
 *
 * Çözücü ASLA tek yol değildir: `null` dönerse çağıran taraf eski akışa düşer.
 */
const RESOLVE_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), RESOLVE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * WeTransfer: `POST /api/v4/transfers/<id>/download` → `direct_link`.
 *
 * İki istek: (1) indirme sayfası — `we.tl` kısa linkini çözmek ve CSRF jetonunu
 * okumak için TEK seferde, (2) API POST'u. Çerezler taşınır (`credentials`),
 * çünkü kişiye özel transferlerde oturum gerekir.
 *
 * Hiçbir hata YUKARI SIZMAZ: dönüş `null` ise çağıran autoflow'a düşer.
 * Burada throw etmek, kullanıcının indirmesini hiç başlatmamak demek olurdu.
 */
async function resolveWetransfer(shareUrl: string): Promise<string | null> {
  try {
    const page = await fetchWithTimeout(shareUrl, {
      credentials: 'include', redirect: 'follow', cache: 'no-store',
    });
    if (!page.ok) return null;
    // `page.url` = yönlendirme SONRASI adres. `we.tl/t-xxx`te hash yoktur;
    // kimlik ancak nihai `/downloads/<id>/<hash>` adresinde bulunur.
    const t9 = parseWetransfer(page.url);
    if (!t9) return null;
    const csrf = readCsrfToken(await page.text());
    const res = await fetchWithTimeout(apiUrl(t9), {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'x-requested-with': 'XMLHttpRequest',
        ...(csrf ? { 'x-csrf-token': csrf } : {}),
      },
      body: apiBody(t9),
    });
    if (!res.ok) return null;
    return pickDirectLink(await res.json());
  } catch {
    return null;
  }
}

async function runResolver(match: { resolver?: string; url: string }): Promise<string | null> {
  if (match.resolver === 'wetransfer') return resolveWetransfer(match.url);
  return null;
}

/**
 * ── Çözülmüş işlerin YENİLENMESİ ────────────────────────────────────────────
 *
 * `direct_link` İMZALIDIR ve kısa ömürlüdür (WeTransfer'de JWT ~600 sn).
 * Ruu bir dosyayı dakikalarca, birden çok bağlantıyla çeker: yavaş hatta büyük
 * bir transfer imzanın ömrünü AŞAR ve sunucu 403 dönmeye başlar.
 *
 * Bunu söylemeden bırakmak "hızlandırdık" demenin yalan hâli olurdu. Bu yüzden
 * çözücüyle doğan işler izlenir; iş hataya düşerse paylaşım adresi YENİDEN
 * çözülür ve motora `renew` gönderilir (motor boyut/etag doğrulayıp diskteki
 * veriyle DEVAM eder — baştan indirmez).
 *
 * Deneme sayısı sınırlıdır: link gerçekten öldüyse (transfer silindi, süre
 * doldu) sonsuz yeniden çözme kullanıcıya yardım etmez, sadece gürültü üretir.
 */
const MAX_RENEW = 2;
/** Motor işi doğana kadar: çözülmüş adres → paylaşım adresi. */
const resolvedPending = new Map<string, string>();
/** İş doğduktan sonra: jobId → { paylaşım adresi, deneme sayısı }. */
const resolvedJobs = new Map<string, { shareUrl: string; attempts: number }>();
/** Aynı iş için eşzamanlı ikinci yenileme uçmasın. */
const renewInflight = new Set<string>();

function trackResolved(directUrl: string, shareUrl: string): void {
  resolvedPending.set(directUrl, shareUrl);
  if (resolvedPending.size > 20) {
    resolvedPending.delete(resolvedPending.keys().next().value as string);
  }
}

/**
 * Motorun panel yayınından yenileme kararı. SAF DEĞİL ama tek karar noktası:
 * hangi işin yenileneceği burada belirlenir, I/O aşağıda.
 */
function onJobsForRenew(jobs: Array<{ id: string; url: string; state: string }>): void {
  for (const job of jobs) {
    // İş ilk kez görüldü — çözülmüş adresi jobId'ye bağla.
    const shareUrl = resolvedPending.get(job.url);
    if (shareUrl !== undefined) {
      resolvedPending.delete(job.url);
      if (!resolvedJobs.has(job.id)) resolvedJobs.set(job.id, { shareUrl, attempts: 0 });
    }
    const entry = resolvedJobs.get(job.id);
    if (!entry) continue;
    if (job.state === 'done') { resolvedJobs.delete(job.id); continue; }
    if (job.state !== 'error') continue;
    if (entry.attempts >= MAX_RENEW || renewInflight.has(job.id)) continue;
    entry.attempts++;
    renewInflight.add(job.id);
    void (async () => {
      try {
        const fresh = await resolveWetransfer(entry.shareUrl);
        if (!fresh) {
          void logTakeover({ url: job.id, action: 'renew-failed', size: -1 });
          return;
        }
        trackResolved(fresh, entry.shareUrl); // yenilenen adres de izlensin
        await ensureOffscreen();
        void chrome.runtime.sendMessage({
          target: 'engine', type: 'renew', jobId: job.id, url: fresh,
        } satisfies Msg).catch(() => undefined);
        void logTakeover({ url: job.id, action: 'renewed', size: -1 });
      } finally {
        renewInflight.delete(job.id);
      }
    })();
  }
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
  // Tier 2: servisin kendi API'si doğrudan indirilebilir adres veriyorsa sayfayı
  // HİÇ açmadan motora ver. Başarısızsa sessizce Tier 3'e düşülür — yeni yol
  // eskisini KALDIRMAZ, önüne geçer.
  if (match.resolver) {
    const direct = await runResolver(match);
    if (direct !== null) {
      markOwn(direct);
      trackResolved(direct, match.url);
      await ensureOffscreen();
      void chrome.runtime.sendMessage({
        target: 'engine', type: 'add', url: direct,
        origin: match.name, sender: ctx.sender,
      } satisfies Msg).catch(() => undefined);
      // Maildeki düğme dönmeye devam etmesin: iş BAŞLADI.
      notifyMail(ctx, 'started');
      void logTakeover({ url: match.name, action: 'resolved', size: -1 });
      return;
    }
    void logTakeover({ url: match.name, action: 'resolve-failed', size: -1 });
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
  if (alarm.name === HELPER_ALARM) {
    void (async () => {
      await settingsReady;
      const was = helperUp;
      await refreshHelperStatus();
      if (was !== helperUp) broadcastHelperState();
      if (!settings.useHelper) void chrome.alarms.clear(HELPER_ALARM);
    })();
    return;
  }
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

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  const m = notificationId.match(/^ruu-dl-(\d+)$/);
  if (!m) return;
  const id = Number(m[1]);
  try {
    // 0 = Aç · 1 = Klasörde göster
    if (buttonIndex === 1) chrome.downloads.show(id);
    else chrome.downloads.open(id);
  } catch { /* dosya taşınmış olabilir */ }
});

chrome.runtime.onMessage.addListener((raw: Msg, sender) => {
  // İkon rozeti: motorun panel yayınlarını SW de dinler (kullanıcı acısı #4 —
  // "indirmeyi kaybediyorum"). Aktif iş sayısı ikonda görünür.
  if (raw.target === 'panel' && raw.type === 'jobs') {
    const active = raw.jobs.filter((j) =>
      j.state === 'downloading' || j.state === 'probing' || j.state === 'finalizing').length;
    void chrome.action.setBadgeText({ text: active ? String(active) : '' }).catch(() => undefined);
    void chrome.action.setBadgeBackgroundColor({ color: '#e8a33d' }).catch(() => undefined);
    // İmzalı adresle doğan işler burada izlenir: süresi dolan link yenilenir.
    onJobsForRenew(raw.jobs);
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
      case 'helper-query': {
        // Options bandı taze durum ister; el sıkışma hiç yapılmadıysa yap.
        if (!handshakeTried) await pushHelper();
        else await refreshHelperStatus();
        broadcastHelperState();
        break;
      }
      case 'helper-status': {
        // Motorun anlık gözlemi (poll hatası) alarmı beklemesin
        if (!raw.up && helperUp) {
          helperUp = false;
          updateActionIcon();
          broadcastHelperState();
        }
        break;
      }
      case 'enable-helper': {
        const r = await enableHelper();
        void chrome.runtime.sendMessage({
          target: 'panel', type: 'helper-result', ok: r.ok, needsInstall: r.needsInstall,
        } satisfies Msg).catch(() => undefined);
        break;
      }
      case 'hello-panel': {
        await ensureOffscreen();
        void chrome.runtime.sendMessage({ target: 'engine', type: 'query' }).catch(() => undefined);
        break;
      }
      case 'deliver': {
        /**
         * Teslim reddedilirse dosyayı KAYBETMEYİZ.
         *
         * Chrome adı `net::IsSafePortablePathComponent` ile doğrular ve
         * uymayanı reddeder. Motor artık adı temizliyor, ama Chrome'un kural
         * kümesi sürüme göre değişebilir ve kategori klasörü de yola giriyor.
         * Bu yüzden reddedilirse sırayla geri çekiliyoruz: klasörsüz dene,
         * sonra saf ASCII adla dene. Tamamlanmış bir indirme adlandırma
         * yüzünden asla çöpe gitmemeli.
         */
        // forced = kullanıcı adı/yolu kaydetme penceresinde ZATEN seçti:
        // kategori klasörü uygulanmaz (kullanıcı yolu > otomatik yol) ve
        // saveAs:false ile pencere İKİNCİ kez açılmaz.
        const attempts = raw.forced
          ? [raw.filename, safeFallbackName(raw.filename)]
          : [
            routeByType(raw.filename, settings.typeFolders, CATEGORY_NAMES),
            raw.filename,                    // kategori klasörü olmadan
            safeFallbackName(raw.filename),  // saf ASCII, uzantı korunur
          ];
        try {
          let id: number | undefined;
          let lastErr: unknown;
          for (const filename of attempts) {
            try {
              // `saveAs` BİLİNÇLİ olarak geçilmiyor. Geçmek, kullanıcının
              // Chrome ayarındaki "Her dosya için kaydetme yerini sor"
              // tercihini EZERDİ. Atlayınca kararı Chrome verir: ayar açıksa
              // kaydetme penceresi çıkar, kapalıysa varsayılan klasöre iner.
              id = await chrome.downloads.download({
                url: raw.blobUrl, filename, conflictAction: 'uniquify',
                ...(raw.forced ? { saveAs: false } : {}),
              });
              break;
            } catch (err) { lastErr = err; }
          }
          if (id === undefined) throw lastErr ?? new Error('errDelivery');
          // Teslim Chrome'a DEVREDİLDİ. Bundan sonrası Chrome'un ve kullanıcının
          // işi: "her dosya için sor" açıksa dosya kaydetme penceresi açık
          // kaldığı sürece indirme in_progress'te bekler. Motorun kısa teslim
          // bekçisi bunu "kayıp mesaj" sanıp işi düşürüyordu — saha ölçümüyle
          // yakalandı (test/field/save-prompt.sh).
          void chrome.runtime.sendMessage({
            target: 'engine', type: 'deliver-ack', jobId: raw.jobId,
          } satisfies Msg).catch(() => undefined);
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
        //
        // SAHA HATASI (2026-08-24): burada `filename` HİÇ geçilmiyordu. Range
        // desteklemeyen bir sunucuda kullanıcının kaydetme penceresinde yazdığı
        // ad sessizce düşüyor, Chrome sunucunun Content-Disposition'ına
        // dönüyordu. Devralma o adı `forcedName` olarak zaten taşıyor — teslimin
        // öteki ucunda (blob) uygulanıyordu ama native dalında unutulmuştu.
        try {
          let id: number | undefined;
          let lastErr: unknown;
          const attempts = nativeDownloadAttempts(raw.url, raw.forcedName);
          // Ad dayatması onDeterminingFilename'e emanet: `filename` seçeneği
          // Content-Disposition'a yenilir (E2E S21).
          if (attempts[0]?.filename) await rememberNativeName(raw.url, attempts[0].filename);
          for (const opts of attempts) {
            try { id = await chrome.downloads.download(opts); break; }
            catch (err) { lastErr = err; }
          }
          if (id === undefined) throw lastErr ?? new Error('errDelivery');
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
      case 'bypass-click': {
        // İçerik betiğinden gelir. Doğrulama SW'de yapılır: sayfa keyfi bir
        // adres gönderip başka bir indirmeyi tarayıcıya kaçıramasın diye
        // işaret yalnız http(s) adresler için konur ve tek kullanımlıktır.
        if (settings.modifierBypass && /^https?:/i.test(raw.url)) await markBypass(raw.url);
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
      void chrome.downloads.search({ id: delta.id }).then((items) => {
        const filename = items[0]?.filename ?? '';
        // Native dalda boyutu BİZ bilmiyoruz (motor tek bayt indirmedi) —
        // Chrome biliyor. Eskiden 0 yazılıyordu ve geçmiş "0 B" gösteriyordu;
        // istatistik de o indirmeleri hiç saymıyordu.
        const size = delivery.size || items[0]?.fileSize || items[0]?.bytesReceived || 0;
        void recordStats(size, delivery.topSpeed);
        void recordHistory(delta.id, { ...delivery, size }, filename);
        celebrate(delta.id, filename, size);
      }).catch(() => {
        void recordStats(delivery.size, delivery.topSpeed);
        celebrate(delta.id, '', delivery.size);
      });
    }
  } else if (delta.state?.current === 'interrupted') {
    await dropDelivery(delta.id);
    // "Her dosya için sor" açıkken kullanıcı pencereyi kapatırsa Chrome
    // USER_CANCELED döner. Bu bir HATA değil, bir karardır: veri OPFS'te
    // durur, kart "Yeniden dene" ile aynı dosyayı yeniden teslim edebilir.
    const raw = delta.error?.current ?? 'interrupted';
    void chrome.runtime.sendMessage({
      target: 'engine', type: 'delivered', jobId: delivery.jobId, ok: false,
      error: raw === 'USER_CANCELED' ? 'errSaveCancelled' : raw,
    } satisfies Msg).catch(() => undefined);
  }
  })();
});
