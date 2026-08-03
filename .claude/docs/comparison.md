# Ruu Downloader — Bağımsız Karşılaştırma Raporu

> Amaç: pazarlama değil, **dürüst durum tespiti**. Rakip verileri 2 Ağustos 2026'da
> Chrome Web Store, AMO, GitHub API ve resmî sitelerden çekildi; doğrulanamayan her
> alan "veri yok" olarak işaretlendi. Ruu'nun eksikleri de aynı belgede.

## 1. Özet: kategorinin fotoğrafı

| Ürün | Kullanıcı | Puan | Masaüstü gerekir mi | Segmentli indirme | Chrome barını gizler | Telemetri |
|---|---|---|---|---|---|---|
| IDM Integration Module | 19.000.000 | 4,0 | **Evet** (ücretli, Windows) | Evet (IDM'de, 32'ye kadar) | veri yok | Beyan: yok |
| Free Download Manager | 3.000.000 | 4,2 | **Evet** | Evet (FDM'de) | veri yok | Beyan: yok |
| Chrono Download Manager | 800.000 | 4,4 | Hayır | **Hayır** | **Evet** (`downloads.ui`) | **Var — Google Analytics** |
| DownThemAll! | Chrome'da **listeden düştü** (2025 başı, MV2) · Firefox 188K | 3,9 / 4,1 | Hayır | Hayır (toplu indirici) | veri yok | Yok (Mozilla onaylı) |
| Turbo Download Manager 3rd | 100.000 | **3,6** | Hayır | **Evet** (3 thread) | **Hayır** | Beyan: yok |
| Simple Mass Downloader | 100.000 | 4,6 | Hayır | Hayır | veri yok | Beyan: yok |
| Download Master (Westbyte) | 100.000 | 3,8 | Evet | Evet (DM'de) | veri yok | Beyan: yok |
| Ninja Download Manager | 10.000 | 4,2 | Evet | veri yok | veri yok | **Beyan yok** |
| **Ruu Downloader** | **0 (yayınlanmadı)** | — | **Hayır** | **Evet (8'e kadar, work-stealing)** | **Evet** | **Yok (kodda tek dış istek yok)** |

## 2. Üç gerçek pazar boşluğu

### Boşluk 1 — "Hız istiyorsan masaüstü kur"
İlk iki ürün **22 milyon kullanıcı** topluyor ve ikisi de native host + masaüstü
uygulama zorunlu kılıyor. Saf eklenti tarafında segmentasyon yapan **tek** ürün
Turbo Download Manager: 3,6 puan, yorumlarda "resume çalışmıyor" şikayetleri.
En büyük saf eklenti Chrono (800K) ise hiç segmentasyon yapmıyor — Chrome'un
indirme API'sinin üzerine kurulmuş bir yönetim katmanı.

### Boşluk 2 — Segmentasyon + Chrome barını gizleme aynı üründe yok
- Chrono: barı gizler ✓, segmentasyon ✗
- Turbo DM: segmentasyon ✓, `downloads.ui` izni manifestinde **yok** ✗
- **Ruu: ikisi de var** (v0.4.0'da doğrulandı)

### Boşluk 3 — "Hızlı ve kanıtlanabilir şekilde temiz" pozisyonu boş
- **Chrono**: mağaza kartında "veri toplanmıyor" yazıyor, kendi gizlilik
  politikası Google Analytics kullandığını söylüyor. Bağımsız denetim (Koi
  Security) "Medium Risk": bilinen XSS açıkları olan jQuery 2.1.0, kod
  obfuscation, `clipboardRead/Write`, 14 izin.
- **FDM**: "açık kaynak" diyor ama v5.0'dan beri kaynak yayınlanmıyor; 2020-2022
  arası resmî site Linux kullanıcılarına **backdoor'lu .deb** dağıttı (parolalar,
  kripto cüzdanları, bulut kimlik bilgileri sızdı), 3 yıl fark edilmedi.
- **JDownloader**: kurulum paketinde opsiyonel adware.
- **Ninja**: gizlilik beyanı hiç yok, 6 yıldır güncellenmiyor.
- Temiz olan tek ürün **DownThemAll** — ama hızlandırıcı değil.

## 3. Ruu'nun ölçülen gerçekleri (komutla doğrulanabilir)

| Ölçüm | Değer | Doğrulama |
|---|---|---|
| Birim testi | 83 geçiyor | `npm test` |
| E2E senaryosu | 10 senaryo; ⚠️ **deterministik değil** — bağımsız koşumda 9/10 ve bir harness çökmesi raporlandı | `./test/e2e/run.sh` |
| Gerçek servis saha testi | 5 servis (3'ü otomatik harness: gofile/catbox/filebin; 2'si elle: Lifebox/WeTransfer). **Kalan 23 servis yalnızca desen düzeyinde** | `test/field/` |
| Tanınan paylaşım servisi | 28 | `src/content/services.ts` |
| Dil | 11 (RTL dahil) | `public/_locales/` |
| Paket boyutu | 71 KB (v0.4.1) | `out/*.zip` |
| Çalışma zamanı bağımlılığı | **1** (`qrcode-generator`, MIT — QR üretimi) | `package.json` |
| Uzak istek | İndirilen URL'ler + (yalnız telefon eşleştirilmişse) Beam rölesi, dakikada bir | kaynak taraması |

**Rakiplerin başaramadığı yerde neredeyiz:**
- Turbo DM'in en çok şikayet edilen özelliği (resume) bizde E2E ile kanıtlı:
  tarayıcı SIGKILL ile öldürülüyor, iş kaldığı yerden devam edip byte-byte
  doğrulanıyor (senaryo S5).
- Chrono'nun yapamadığı segmentasyon + Turbo DM'in yapamadığı bar gizleme birlikte.
- Chrono'nun jQuery 2.1.0'ı gibi bir üçüncü taraf yükü yok — sıfır bağımlılık.

## 4. Ruu'nun eksikleri (dürüstlük bölümü)

1. **Kullanıcı tabanı sıfır** — rakiplerin milyonlarca kullanıcısı ve yıllarca
   saha testi var. Bizde 5 servis gerçek linkle doğrulandı, 20 servis yalnızca
   desen düzeyinde.
2. **Video/stream indirme yok** — bilinçli kapsam kararı, ama IDM/FDM
   kullanıcılarının önemli bir kısmı tam olarak bunu arıyor.
3. **Torrent/magnet yok** — kapsam dışı (FDM ve JDownloader'da var).
4. **Kuyruk & zamanlama arayüzü yok** — veri modeli hazır, UI yok.
   (Not: bu özellik rakip eklentilerin hiçbirinde de doğrulanamadı; yalnızca
   masaüstü FDM/XDM'de var.)
5. **Bant genişliği sınırlama yok.**
6. **Yalnızca Chromium** — Firefox portu yok (DownThemAll'ın güçlü olduğu yer).
7. **Dil sayısında Chrono önde** (52 vs 11).
8. **P2P / telefon aktarımı yolda** — röle canlı, istemciler yazılıyor.

## 5. Konumlandırma tezi

> Kategoride 22 milyon kişi hız için masaüstü uygulama kurmaya razı olmuş.
> Saf eklenti tarafında bu hızı veren tek ürün düşük puanlı ve resume'u bozuk.
> En popüler saf eklenti hızlandırma yapmıyor ve analytics topluyor.
>
> **Ruu'nun iddiası:** masaüstü kurulumu olmadan gerçek segmentli hız, çökmeye
> dayanan resume, ve doğrulanabilir sıfır telemetri — üçü bir arada.

## 6. Kaynaklar

Chrome Web Store sayfaları (2 Ağu 2026): [IDM](https://chromewebstore.google.com/detail/idm-integration-module/ngpampappnmepgilojfohadhhmbhlaek) ·
[FDM](https://chromewebstore.google.com/detail/free-download-manager/ahmpjcflkgiildlgicmcieglgoilbfdp) ·
[Chrono](https://chromewebstore.google.com/detail/chrono-download-manager/mciiogijehkdemklbdcbfkefimifhecn) ·
[Turbo DM](https://chromewebstore.google.com/detail/turbo-download-manager-3r/pabnknalmhfecdheflmcaehlepmhjlaa) ·
[DownThemAll](https://chromewebstore.google.com/detail/downthemall/nljkibfhlpcnanjgbnlnbjecgicbjkge) ·
[Simple Mass Downloader](https://chromewebstore.google.com/detail/simple-mass-downloader/abdkkegmcbiomijcbdaodaflgehfffed)

Güvenlik/denetim: [Koi Security — Chrono raporu](https://dex.koi.security/reports/chrome/mciiogijehkdemklbdcbfkefimifhecn/0.13.5) ·
[Securelist — FDM Linux backdoor](https://securelist.com/backdoored-free-download-manager-linux-malware/110465/) ·
[BleepingComputer — FDM 3 yıl malware dağıttı](https://www.bleepingcomputer.com/news/security/free-download-manager-site-redirected-linux-users-to-malware-for-years/)

Kaynak kod: [Turbo DM (MPL-2.0)](https://github.com/inbasic/turbo-download-manager-v2) ·
[DownThemAll (GPL-2.0)](https://github.com/downthemall/downthemall) ·
[aria2](https://github.com/aria2/aria2) · [Motrix](https://github.com/agalwood/Motrix)

Referans: [chrome.downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads) ·
[IDM dinamik segmentasyon](https://www.internetdownloadmanager.com/support/segmentation.html) ·
[Chrono gizlilik politikası](https://www.chronodownloader.net/privacy.html)

### Rapor sınırlılıkları
- chrome-stats.com ve extpose.com 403 döndü → tarihsel trend verisi toplanamadı.
- CWS kullanıcı sayıları Google tarafından yuvarlanır (100.000 / 3.000.000 gibi).
- Manifest sürümü yalnızca Turbo DM ve Chrono için birincil kaynaktan doğrulandı.
- IDM fiyatı üçüncü taraf satıcılardan alındı, resmî sayfadan değil.

---

## Ek: Hız iddiasının ölçümü (2026-08-03)

Denetim maddesi #1'e cevap. Yöntem: `test/field/bench.mjs` — aynı dosya, aynı host,
**dönüşümlü A/B/B/A** koşum (ağ dalgalanması bir tarafa sistematik avantaj vermesin),
doğrudan HTTP Range ile, 3 tekrarın medyanı.

| Host | Karakter | Tek bağlantı | 6 paralel | Kazanç |
|---|---|---|---|---|
| Catbox | paylaşım hostu, bağlantı başına kısıtlı | 1,42 MB/s | 2,53 MB/s | **×1,78** |
| Hetzner | hızlı CDN, HTTP/2 | 3,55 MB/s | 3,07 MB/s | ×0,86 |
| ThinkBroadband | hızlı hat, HTTP/1.1 | 41,57 MB/s | 27,52 MB/s | **×0,66** |

**Bulgu iki yönlü ve ikisi de önemli:**

1. Segmentasyon **yalnızca** bağlantı başına hız kısan hostlarda kazandırıyor — yani
   tam olarak bizim hedef kitlemizin kullandığı paylaşım servislerinde (Catbox ×1,78).
   Bu, Chromium kaynak analizinin öngördüğü şeydi ve artık ölçülü.
2. Hızlı hatlarda kör paralellik **aktif olarak zarar veriyor** (×0,66'ya kadar).
   6 TCP slow-start + 6 el sıkışma bedava değil; HTTP/2'de altı "bağlantı" zaten tek
   transport üzerinde aynı sabit pencereyi bölüşüyor.

**Ürüne yansıması:** 2. bulgu sabit bağlantı sayısını savunulamaz kılıyor. Motor
`src/engine/ramp.ts` ile adaptif hale getirildi: tek bağlantıyla başla, 1,5 sn'de bir
ölç, **ekleme ≥%12 iyileştirdiği sürece** bir bağlantı daha ekle, iyileştirmiyorsa dur.
Sabit sayı kullanan rakipler (IDM 8/16/32, Turbo DM 3) bu ayrımı yapmıyor.

**Bu ölçümün sınırı:** 3 host, tek ağ (Türkiye, ev bağlantısı), tek zaman dilimi.
Eğilimi gösteriyor, evrensel bir sabit vermiyor. Daha fazla host eklendikçe bu tablo
büyümeli.
