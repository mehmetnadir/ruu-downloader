# PRD — Parça 1: Mimari, İzinler, Veri Modeli

> Durum: ONAY BEKLİYOR (Nadir) · 2026-07-30
> Kaynak araştırma: memory `architecture-findings` (TDM v2 satır-satır analizi) + `project-scope-decisions`

## 1. Bileşen Mimarisi

```
┌─ Service Worker (worker.ts) ── sadece YÖNLENDİRİCİ, motor değil
│   • downloads.onCreated → cancel → işi motora devret (devralma)
│   • chrome.alarms → zamanlanmış kuyruk tetikleme (SW uyusa da alarm uyandırır)
│   • context menu, badge, bildirimler
│   • session DNR kuralları (Referer/Origin gereken CDN'ler; iş bitince temizle)
│
├─ Offscreen Document (engine host) ── motorun kalıcı evi
│   • fetch pompası: paralel Range istekleri, dinamik segmentasyon + work-stealing
│   • Disk Worker'a chunk aktarımı (transferable ArrayBuffer)
│   • SW ölse de indirme kesintisiz sürer (TDM'in kanıtlanmış pattern'i)
│
├─ Disk Worker (dedicated worker, offscreen içinde)
│   • OPFS createSyncAccessHandle → write(buf, {at: offset}) + periyodik flush
│   • Segment doğrudan nihai byte konumuna yazılır → MERGE FAZI YOK
│   • Not: sync access handle SADECE dedicated worker'da çalışır (bu yüzden ayrı worker)
│
├─ Side Panel (UI) ── saf arayüz, motor barındırmaz
│   • İndirme listesi + canlı segment haritası + kuyruk görünümü
│   • showSaveFilePicker BURADA (user activation var) → handle IDB'ye persist,
│     motora devredilir; resume'da requestPermission
│   • runtime.connect port ile motordan delta push (1 Hz polling YOK — TDM'in hatası)
│
└─ Resolvers (paylaşım servisi çözücüleri) — Faz 2
    • Tier 1: URL dönüşümü (Dropbox dl=1, OneDrive download param)
    • Tier 2: provider modülü (WeTransfer internal API — transferwee pattern'i)
    • Tier 3: arka plan sekmesi + buton tetikleme + onCreated devralma (evrensel)
```

Teslim zinciri (spike ile doğrulanacak): indirme sırasında OPFS (dayanıklı, flush'lı)
→ tamamlanınca kullanıcının seçtiği FSA handle'a `pipeTo` (blob YOK, bellek sabit).
Spike alternatifi: hedefe doğrudan positioned write + periyodik close/reopen checkpoint.

## 2. manifest.json İzinleri

| İzin | Gerekçe (CWS review notuna girecek) |
|---|---|
| `downloads` | Devralma (onCreated/cancel) + tamamlanan dosyayı Downloads'a teslim |
| `storage` + `unlimitedStorage` | İş/kuyruk durumu + OPFS kotası (büyük dosyalar) |
| `sidePanel` | Ana UI |
| `offscreen` | Motor evi — gerekçe DÜRÜST yazılacak (TDM'in IFRAME_SCRIPTING hilesi YASAK) |
| `alarms` | Zamanlanmış/tekrarlayan kuyruklar (SW uykudayken bile tetikler) |
| `notifications` | İndirme bitti/hata bildirimi |
| `scripting` | Tier 3 resolver (buton tetikleme) — Faz 2'de eklenebilir |
| `power` | İndirme sırasında sistem uykusunu engelle (requestKeepAwake) |
| `declarativeNetRequestWithHostAccess` | Referer gereken CDN'ler için session kuralı |
| `contextMenus` | "Ruu ile indir" sağ-tık |
| host_permissions: `*://*/*` | Ranged fetch her domain'e gidebilmeli — kaçınılmaz, gerekçelenecek |

`minimum_chrome_version: "116"`. Content script: SADECE mail domain'leri (Faz 2, mail.google.com + outlook.*). `clipboardRead` YOK.

## 3. Veri Modeli (kuyruk + zamanlama İLK GÜNDEN modelde)

```ts
interface Job {
  id: string;
  url: string;              // orijinal istek
  finalUrl?: string;        // resolver/redirect sonrası
  filename: string;
  size?: number;
  validator?: { etag?: string; lastModified?: string };  // resume doğrulaması
  queueId: string;          // ← çoklu kuyruk desteğinin temeli
  state: 'queued'|'resolving'|'downloading'|'paused'|'finalizing'|'done'|'error';
  ranges: [number, number][];      // tamamlanan aralıklar (kalıcı; OPFS ile çapraz doğrulanır)
  destination: { kind: 'fsa'; handleId: string } | { kind: 'chrome-downloads' };
  connections: number;      // iş bazında override (kuyruk default'unu ezer)
  error?: { code: string; attempts: number };
  createdAt: number; completedAt?: number;
}

interface Queue {
  id: string; name: string;
  maxConcurrentJobs: number;       // kuyruk içi eşzamanlı iş
  maxConnectionsPerJob: number;    // varsayılan bağlantı sayısı (1-8)
  schedule?: Schedule;             // yoksa: manuel kuyruk
  postAction: 'none' | 'notify';   // faz 3: 'sleep' değerlendirilebilir
  enabled: boolean;
}

interface Schedule {
  kind: 'once' | 'daily' | 'weekly';
  startTime: string;               // "02:00"
  stopTime?: string;               // pencere sonu: aktif işler pause edilir
  days?: number[];                 // weekly: [1,3,5]
}
```

Zamanlama mekaniği: her `Schedule` bir `chrome.alarms` kaydına derlenir. Alarm → SW uyanır
→ offscreen'i garanti eder → kuyruğu başlatır/durdurur. Tekrarlayan indirme (aynı URL'i
periyodik çek, ör. gece yedek dosyası) = `Schedule`'lı kuyrukta kalıcı Job şablonu +
ETag kontrolü (değişmediyse indirme atlanır). Bu, IDM'in "senkronizasyon kuyruğu"nun karşılığı.

MVP'de UI tek kuyruk gösterir ("Main"); model çoklu kuyruğu baştan taşır → Faz 2'de
sadece UI eklenir, migration gerekmez.

## 4. Fazlar

| Faz | Kapsam |
|---|---|
| **1 (MVP)** | Motor (segmentli fetch + work-stealing + resume) · devralma · Side Panel + segment haritası · tek kuyruk · pause/resume · Range yoksa native'e zarif düşüş |
| **2** | Çoklu kuyruk UI · zamanlama/tekrar (alarms) · resolvers (Tier 1-2-3) · mail butonu · context menu link toplama |
| **3** | Bant genişliği limiti · kategori bazlı otomatik klasörleme · senkronizasyon kuyruğu iyileştirmeleri |

Kapsam dışı (kalıcı): video/stream yakalama (HLS/DASH), harici CLI bağımlılığı.

## 5. Stack

TypeScript strict + Vite + CRXJS · Preact (panel) · CSS token'lı tema (hardcoded hex yasak,
light+dark) · Vitest + yerel throttled Range test sunucusu (TDM `server/` pattern'i) · cdpilot E2E.
