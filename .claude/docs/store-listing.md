# Chrome Web Store — Yayın Paketi

Öğe kimliği: `kcbcgiflgolgekfpgijpjeonjfjpcdid` · Dashboard: https://chrome.google.com/webstore/devconsole

> Bu dosya mağaza formunun her alanı için hazır metin içerir. Nadir görselleri
> hazırlarken buradaki metinleri kopyalayabilir. Abartı yok — her iddia üründe var.

---

## 1. Ad (45 karakter sınırı)

```
Ruu Downloader — Segmented Download Manager
```
(43 karakter)

TR mağaza görünümü `_locales/tr` üzerinden otomatik: **Ruu Downloader**

## 2. Kısa açıklama (132 karakter sınırı)

**EN**
```
Parallel-connection speed and crash-proof resume — no desktop app, no account. Grab share links straight from your inbox.
```
(119 karakter)

**TR**
```
Masaüstü uygulama ve hesap olmadan paralel hızlanma, çökmeye dayanıklı devam; paylaşım linkleri doğrudan gelen kutunuzdan.
```
(116 karakter)

## 3. Ayrıntılı açıklama (EN)

```
Ruu is a modern download manager that lives inside Chrome — no companion app, no
account, no telemetry.

WHAT IT DOES

⚡ Parallel segmented downloads
Ruu splits each file across up to 8 connections and rebalances them while the
transfer runs: when one connection finishes early it steals half of the slowest
remaining segment, so a single slow mirror never holds the download back. The
connection count adapts to your network speed and hardware automatically.

💾 Resume that actually survives
Every byte written to disk is journaled. Close Chrome, lose power, crash the
browser — the download comes back paused and continues exactly where it stopped,
byte for byte. Before resuming, Ruu re-validates the file on the server
(ETag/Last-Modified) so you never end up with two different versions stitched
together.

🔗 Expired link rescue
Signed CDN links often die halfway through a big download. Instead of starting
over, paste a fresh link: Ruu verifies it is the same file and keeps your
progress.

🧲 Takes over browser downloads
One-time opt-in makes Ruu your default download experience — Chrome's download
bubble is hidden and downloads above your chosen size threshold go through the
engine. A built-in decision log always tells you why a download was, or wasn't,
taken over.

📬 One click from your inbox
Desktop download managers have walked share-page flows for years — but they need
a desktop app running. Ruu does it inside the browser: it recognizes share links
from 28 services (WeTransfer, Google Drive, Dropbox,
MediaFire, Box, OneDrive, Gofile, TeraBox, SwissTransfer, pCloud, Filemail and
more) directly in Gmail and Outlook. Click the Ruu button and the extension walks
through the share page's consent and download steps for you. Per-service you can
choose: Off, Ask, or fully Automatic.

🗂 Stays organized
Images, video, music, archives, documents and apps each land in their own folder
(optional). Completed downloads show when they arrived, which service they came
from, and who sent them.

🕶 Private downloads
The file lands on disk; nothing appears in your browser's download history and it
is excluded from local statistics.

🔔 Your choice of ending
Stay silent, get a notification with an Open button, open a "downloaded" tab — or
turn on party mode and let a video of your choosing play when the file lands.

🌍 11 languages including right-to-left Arabic. Icon-first interface with minimal
text. Full keyboard support, screen-reader announcements, and reduced-motion
support throughout.

PRIVACY

Ruu collects nothing. No analytics, no telemetry, no remote logging, no third
party services. Statistics (download count, total bytes, best speed) are stored
on your device only. The extension makes network requests solely to the URLs you
choose to download. Full policy:
https://github.com/mehmetnadir/ruu-downloader/blob/main/PRIVACY.md

WHAT IT DOES NOT DO

Ruu is a productivity tool. It does not rip streaming video (HLS/DASH), and it
does not touch torrent networks. Services with end-to-end encryption (MEGA,
Proton Drive, Wormhole) cannot be accelerated by any extension — Ruu says so
plainly instead of failing silently.

OPEN SOURCE

MIT licensed, developed in the open, verified by 72 unit tests and a 10-scenario
end-to-end suite that checks every downloaded file byte by byte:
https://github.com/mehmetnadir/ruu-downloader
```

## 4. Ayrıntılı açıklama (TR)

```
Ruu, Chrome'un içinde yaşayan modern bir indirme yöneticisidir — yardımcı uygulama
yok, hesap yok, telemetri yok.

NE YAPAR

⚡ Paralel segmentli indirme
Ruu her dosyayı en fazla 8 bağlantıya böler ve indirme sürerken dengeler: erken
biten bağlantı, en yavaş kalan parçanın yarısını devralır; böylece tek bir yavaş
sunucu tüm indirmeyi geciktirmez. Bağlantı sayısı ağ hızınıza ve donanımınıza göre
kendiliğinden ayarlanır.

💾 Gerçekten dayanan devam etme
Diske yazılan her byte kayıt altına alınır. Chrome'u kapatın, elektrik kesilsin,
tarayıcı çöksün — indirme "bekliyor" olarak geri gelir ve tam kaldığı byte'tan
devam eder. Devam etmeden önce dosyanın sunucuda değişip değişmediği doğrulanır;
iki farklı sürüm asla birbirine dikilmez.

🔗 Süresi dolan link kurtarma
İmzalı bağlantılar büyük indirmelerin ortasında sık sık ölür. Baştan başlamak
yerine yeni linki yapıştırın: Ruu aynı dosya olduğunu doğrular ve ilerlemenizi
korur.

🧲 Tarayıcı indirmelerini devralır
Tek seferlik onayla Ruu varsayılan indirme deneyiminiz olur — Chrome'un indirme
balonu gizlenir, seçtiğiniz boyutun üzerindeki indirmeler motora gider. Yerleşik
karar günlüğü, bir indirmenin neden devralındığını (ya da alınmadığını) her zaman
söyler.

📬 Gelen kutunuzdan tek tıkla
Masaüstü indirme yöneticileri paylaşım sayfası akışlarını yıllardır yürütüyor —
ama çalışan bir masaüstü uygulaması gerekiyor. Ruu bunu tarayıcının içinde yapar:
Gmail ve Outlook'ta 28 servisin paylaşım linkini tanır (WeTransfer, Google Drive,
Dropbox, MediaFire, Box, OneDrive, Gofile, TeraBox, SwissTransfer, pCloud,
Filemail ve daha fazlası). Ruu düğmesine basın; eklenti paylaşım sayfasındaki onay
ve indirme adımlarını sizin yerinize tamamlar. Her servis için seçebilirsiniz:
Kapalı, Sor ya da tamamen Otomatik.

🗂 Düzeni korur
Görsel, video, müzik, arşiv, belge ve uygulamalar kendi klasörüne iner (isteğe
bağlı). Tamamlanan indirmeler ne zaman geldiğini, hangi servisten indiğini ve
kimin gönderdiğini gösterir.

🕶 Gizli indirme
Dosya diske iner; tarayıcı geçmişinde iz kalmaz ve yerel istatistiklere girmez.

🔔 Bitişi siz seçin
Sessiz kalsın, Aç düğmeli bildirim gelsin, "indirildi" sekmesi açılsın — ya da
parti modunu açın, dosya inince belirlediğiniz video çalsın.

🌍 11 dil, sağdan sola Arapça dahil. İkon öncelikli, az metinli arayüz. Tam klavye
desteği, ekran okuyucu duyuruları ve hareket azaltma desteği.

GİZLİLİK

Ruu hiçbir şey toplamaz. Analitik yok, telemetri yok, uzak kayıt yok, üçüncü taraf
servis yok. İstatistikler (indirme sayısı, toplam byte, rekor hız) yalnızca
cihazınızda tutulur. Eklenti yalnızca sizin indirmeyi seçtiğiniz adreslere ağ
isteği yapar.

NE YAPMAZ

Ruu bir verimlilik aracıdır. Yayın videosu (HLS/DASH) indirmez, torrent ağlarına
dokunmaz. Uçtan uca şifreli servisler (MEGA, Proton Drive, Wormhole) hiçbir eklenti
tarafından hızlandırılamaz — Ruu sessizce başarısız olmak yerine bunu açıkça söyler.

AÇIK KAYNAK

MIT lisanslı, açıkta geliştirildi; 72 birim testi ve indirilen her dosyayı byte
byte doğrulayan 10 senaryoluk uçtan uca test paketiyle denetleniyor:
https://github.com/mehmetnadir/ruu-downloader
```

## 5. Kategori & etiketler

- Kategori: **Workflow & Planning** (alternatif: Tools)
- Dil: Türkçe + English (mağaza otomatik `_locales`'tan alır)

## 6. Gizlilik sekmesi cevapları (form birebir)

| Alan | Cevap |
|---|---|
| Tek amaç (single purpose) | "Accelerate and manage file downloads in the browser: split downloads across parallel connections, resume interrupted transfers, and start downloads from recognized file-sharing links." |
| `downloads` | "Deliver completed files to the user's Downloads folder and take over browser-initiated downloads so they can be accelerated." |
| `downloads.ui` | "Hide Chrome's download bubble when the user opts in to make the extension the default download experience." |
| `downloads.open` | "Open a finished file when the user clicks Open in the panel or notification." |
| `storage` / `unlimitedStorage` | "Store user settings and in-progress download data (byte ranges) locally." |
| `offscreen` | "Host the download engine and its disk worker so active transfers survive service worker suspension." |
| `sidePanel` | "The extension's main user interface." |
| `notifications` | "Inform the user when a download completes or a share link has expired." |
| `alarms` | "Close automation windows reliably and schedule cleanup that survives service worker suspension." |
| `power` | "Prevent the system from sleeping while a download is in progress." |
| `scripting` | "On recognized file-sharing pages the user explicitly chose, click the consent/download button to start the transfer." |
| `windows`/`tabs` (izin gerektirmez) | "Open and close the temporary share-page window used to start a download." |
| host_permissions `*://*/*` | "Download files from any host the user chooses, using HTTP Range requests. Ruu never requests a URL the user didn't initiate." |
| Uzak kod kullanıyor mu | **Hayır** — tüm kod pakette |
| Veri topluyor mu | **Hayır** — hiçbir kategori işaretlenmez |
| Limited Use beyanı | Onaylanır (veri toplanmadığı için tüm şartlar sağlanır) |
| Gizlilik politikası URL | `https://github.com/mehmetnadir/ruu-downloader/blob/main/PRIVACY.md` |

## 7. Görseller (Nadir hazırlayacak)

| Varlık | Boyut | Öneri içerik |
|---|---|---|
| Küçük promo | 440×280 | Segment haritalı kart + "Segmented. Resumable. Private." |
| Ekran görüntüsü 1 | 1280×800 | Panel: aktif indirme, canlı segment haritası, hız/ETA |
| Ekran görüntüsü 2 | 1280×800 | Gmail'de mail + linkin yanında Ruu düğmesi (WeTransfer maili) |
| Ekran görüntüsü 3 | 1280×800 | Ayarlar: büyük ikonlu satırlar + servis modu listesi |
| Ekran görüntüsü 4 | 1280×800 | Crash-resume: "Bekliyor" kartı + devam düğmesi (hikâye anlatan) |
| Ekran görüntüsü 5 | 1280×800 | "İndirildi" sekmesi / bildirim + karanlık-aydınlık tema yan yana |

Not: Ekran görüntülerinde gerçek arayüz kullanılmalı (mağaza sahte görsel kabul
etmiyor). `docs/assets/panel.png` örnek olarak repoda.

## 8. Yayın öncesi kontrol listesi

- [x] Manifest izinleri minimal + her biri gerekçeli
- [x] PRIVACY.md yayında
- [x] MIT LICENSE
- [x] 11 dil `_locales`
- [x] Uzak kod yok (tüm bağımlılıklar pakette)
- [x] Test: 72 unit + 10/10 E2E
- [ ] Görseller (Nadir)
- [ ] Gizlilik sekmesi formu (Nadir — cevaplar yukarıda)
- [ ] Kategori seçimi (Nadir)
- [ ] "Yayınla" (inceleme 1-3 gün sürebilir)
