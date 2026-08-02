# PRD — Parça 3: Ürün Yol Haritası (Nadir'in istek listesi, 2026-07-30)

## Kullanıcı Acıları Araştırması (2026-07-31 — tur pusulası)

Gerçek kullanıcı şikayetlerinden (CWS yorumları, IDM forumları) çıkan sıralı acılar:

1. **Süresi dolan linkler** (EN BÜYÜK acı): imzalı/geçici CDN URL'leri resume'da ölüyor;
   kullanıcı %95'te kalan dosyayı baştan indirmek zorunda kalıyor.
   → **Ruu çözümü (Tur 11): "linki yenile"** — hatalı işe yeni URL yapıştır, ETag/boyut
   doğrulanır, MEVCUT aralıklarla kaldığı yerden devam. Rakiplerde zayıf, bizde doğal
   (aralık günlüğü zaten var).
2. **%95-99'da çöken indirme** → crash-resume + ack günlüğü ile bizde çözülü ✓
3. **Devralma güvenilmez / ayar kaybolması / Chrome barı gizlenemiyor** (FDM şikayetleri)
   → teşhis günlüğü + storage.local kalıcılığı + setUiOptions bizde ✓
4. **İkonda ilerleme yok** ("indirmeyi kaybediyorum") → **Tur 11: action badge**
   (aktif sayaç + tekil işte %) — ucuz, yüksek algı değeri.
5. Karanlık mod yok / kötü yerelleştirme / reklam-izleme (Chrono şikayeti)
   → bizde tema + 11 dil + sıfır telemetri ✓ (mağaza metninde vurgulanacak).

> Durum: YAŞAYAN BELGE — her madde kendi dalgasında detaylandırılır.
> Fizibilite notları dürüst platform sınırlarını içerir.

## Dalga sırası ve fizibilite

| # | İstek | Fizibilite / Yaklaşım | Dalga |
|---|---|---|---|
| 1 | **Animasyonlar** (metin önde, arkada akan barlar, kalp atışı, yumuşak) | CSS @keyframes + WAAPI, 0 KB ek; RESTRAINED seviye; keyed renderer şart | **BU DALGA** |
| 2 | **SVG ikon paketi** | Lucide (ISC lisans) inline path'ler — bağımlılıksız | **BU DALGA** |
| 3 | **Tek-kelime durum sözcükleri** (Claude tarzı) | "İniyor · Akıyor · Hızlanıyor…" rotasyonu, crossfade'li; i18n-hazır dizi | **BU DALGA** |
| 4 | **Çoklu dil** (en çok konuşulan diller) | chrome.i18n `_locales/`; ikon-öncelikli minimal metin (Nadir kuralı) → az anahtar; ar/he için RTL. i18n-architect skill ile | Sonraki |
| 5 | **Cihaza otomatik ayar** | `navigator.connection` (downlink/effectiveType) + `hardwareConcurrency` + `deviceMemory` → önerilen bağlantı sayısı/backpressure; varsayılan mod "Otomatik" | Yakın |
| 6 | **Kayıt yerini indirme başladıktan SONRA sor** | Motor zaten OPFS'e iniyor — teslim anına kadar hedef seçilebilir; süre kaybı sıfır. Tür bazlı klasör: `downloads.download` relative path (Görseller/, Video/…) veya FSA | Yakın |
| 7 | **Gizli indirme** | Üç bileşen: FSA teslimi (hiç `chrome.downloads` kaydı OLUŞMAZ), `downloads.erase` (iz temizleme), panelde oturum-içi "gizli" işaretli işler (kalıcı geçmişe yazılmaz). Incognito: split mode + kullanıcı izni | Orta |
| 8 | **Virüs tarama** | `chrome.downloads` teslim yolu = Chrome Safe Browsing taraması ZATEN devrede. "Her şeye rağmen indir" = FSA yolu (tarama yok, açık kullanıcı tercihi). Not: eklenti API'sinden tarama tetiklenemez — yol seçimiyle yönetilir | Orta |
| 9 | **Bildirim modları** | DND (sessiz) / Normal (chrome.notifications) / **Çok Rahatsız Et**: kullanıcının belirlediği YouTube videosu `tabs.create` ile açılıp oynar 😄 — hepsi kolay | Orta |
| 10 | **İndir-ve-aç** | `chrome.downloads.open` (+`downloads.open` izni; bildirim tıklaması gesture sayılır) | Orta |
| 11 | **İndir-ve-yükle** | SINIR: eklenti installer ÇALIŞTIRAMAZ (platform güvenliği). Yapılabilen: dosyayı aç → OS installer'ı başlatır. "Aç" ile aynı mekanizma, ayrı adlandırma | Orta |
| 12 | **Erişilebilirlik (Apple seviyesi)** | Sürekli katman: ARIA live (indirme anonsları), tam klavye, :focus-visible, kontrast, reduced-motion, SR etiketleri. Her dalgada denetim | Sürekli |
| 13 | **Önizleme (her formata)** | Panel-içi viewer: görsel/video/ses (native), PDF, metin/kod, ZIP listesi. Bonus: OPFS sayesinde indirme BİTMEDEN önizleme mümkün. Kapatılabilir | Faz 3 |

## Ek kararlar (2026-07-30 gece, Nadir)

**Varsayılan deneyim:** İlk açılışta BİR KEZ sorulur ("Ruu'yu varsayılan indirme deneyimi
yap?"). Evet → `chrome.downloads.setUiOptions({enabled:false})` ile Chrome'un indirme
balonu gizlenir + devralma açık; Hayır → pasif mod (devralma kapalı, Chrome UI kalır).
Sınır notu: Side Panel'i indirme anında otomatik AÇAMAYIZ (sidePanel.open user gesture
ister) — rozet + bildirim ile telafi.

**Retry politikası:** Ağ hatasında varsayılan 1 yeniden deneme (bağlantı başına);
ayarlardan 0-10 arası. Eşik: bağlantı × (1+retry) ardışık hata → iş düşer.

**Analytics (CWS kuralları neyse o):** Chrome politikası analytics'e İZİN VERİR ama
şartlı: gizlilik politikası + Privacy tab beyanı + Limited Use (veri satışı/profil
çıkarma yasak) + tarama verisi toplama yasak. Kararımız: v1'de uzak telemetri YOK —
yerel istatistikler (toplam indirme, ortalama hız) panelde gösterilir; ileride
İSTEĞE BAĞLI (opt-in) anonim telemetri, açık beyan ile. Review riskini sıfırlar.

## #14 — Cihazlar arası "Ruu Beam" (telefonda gör → PC'ye indirt) [TASARIM]

Kısıt: Chrome mobil, uzantı DESTEKLEMEZ → mobil taraf uzantı olamaz.
Önerilen mimari (self-host dostu, free-tier uyumlu):

1. **Mobil taraf:** Küçük bir PWA — Android'de "Paylaş → Ruu'ya Gönder" (Web Share
   Target). Herhangi bir uygulamadan link paylaşılır.
2. **Köprü:** Cloudflare Worker (ücretsiz tier) — sadece kısa mesaj kuyruğu:
   {pairId, url, zaman}. İçerik geçmez, SADECE URL geçer.
3. **PC tarafı:** Ruu uzantısı Web Push aboneliği (VAPID) — Worker push'lar,
   SW uyanır, iş kuyruğa girer, Ruu indirir. Push yoksa: 30sn'lik polling fallback'i.
4. **Eşleştirme:** PC panelinde QR (pairId+anahtar) → telefonda PWA okur. Uçtan uca
   basit şifreleme (URL, pair anahtarıyla AES-GCM) → Worker URL'leri okuyamaz.

Alternatifler elendi: Chrome'un yerleşik "cihaza gönder" özelliğinin uzantı API'si yok;
Telegram-bot köprüsü bağımlılık getiriyor. Beam ayrı iş paketi (ruu-beam/): PWA +
Worker + uzantı push modülü. Sıra: çekirdek turlar bitince.

## Otomatik indirme mimarisi (2026-08-02) — üç faz

Hedef: "WeTransfer linki geldi → hemen insin → Downloads'a kaydedilsin →
'dosyanız indirildi' sekmesi açılsın." Mesele **maili ne zaman gördüğümüz**.

| Faz | Kapsam | Durum |
|---|---|---|
| **1 — Mail sekmesi açıkken** | Gmail/Outlook açıkken content script linki görür; servis 'auto' modda ise kullanıcı hiçbir şeye tıklamadan akış başlar. Bitince notifyMode='tab' ile "indirildi" sekmesi açılır. | **BİTTİ** (E2E S10) |
| **2 — Mail kapalıyken (Gmail API)** | Uzantı, kullanıcının izniyle (chrome.identity + gmail.readonly) yeni mailleri yoklar; sekme açık olmasa da linki yakalar. Alarm ile 2-5 dk periyot. Not: hassas kapsam → CWS'te ek doğrulama süreci; TAMAMEN opt-in, bağlanmazsa özellik kapalı. | Sonraki |
| **3 — Telefondan (Ruu Beam)** | Telefonda maili gören kullanıcı linki paylaşır → şifreli röle → PC iner. Röle CANLI (ruu-beam.workers.dev). PWA + uzantı istemcisi kaldı. | Röle bitti |

**Neden Faz 2 doğrudan yapılmadı:** Gmail API hassas kapsam gerektirir ve
mağaza incelemesini ağırlaştırır. Faz 1 çoğu senaryoyu (kullanıcı zaten
mailine bakıyorken) çözer; Faz 2 "bilgisayar açık ama mail kapalı" boşluğunu
kapatır ve isteğe bağlı kalır.

**Servis modu modeli:** her servis için Kapalı / Sor / Otomatik (varsayılan Sor).
'auto' bilinçli opt-in: yalnızca GÖRÜNÜR link, sekme başına tek kez, izleme
parametreleri yok sayılarak tekilleştirilmiş.

## Bu dalganın kapsamı (onaylı sayılır — Nadir talep etti)

1. Keyed renderer (animasyon sıfırlanma bug'ının kökten çözümü)
2. Kart mimarisi: metin önde, tüm kartın arka planı akan progress katmanı (shimmer sweep, GPU-safe translateX)
3. Kalp atışı: aktif indirme noktası (double-thump, 1.8s)
4. Tek-kelime durum rotasyonu (4s, WAAPI crossfade)
5. Lucide ikon seti (inline, ISC)
6. Segment haritası: 48 sabit bucket, node yeniden kurulmaz (opacity güncellenir)
7. A11y hızlı kazanımlar: aria-label, aria-live, focus-visible, reduced-motion tam kapsama


## Faz 4-5: Cihazdan cihaza aktarım (2026-08-02 araştırması)

### CWS politikası — P2P serbest mi? EVET (koşullu)

Mağaza politikası **teknolojiyi değil içeriği** kısıtlar. WebRTC tabanlı P2P dosya
paylaşımı serbest (FastShare, P2P File Transfer gibi eklentiler yayında; PairDrop/
Snapdrop ekosistemi yaygın), hatta torrent istemcisine köprü kuran eklentiler bile
mağazada. YASAK olan: telif korumalı içeriğe yetkisiz erişimi kolaylaştırmak, kripto
madenciliği, yasa dışı faaliyet. Ruu'nun konumlandırması (verimlilik aracı, video
ripper yok, torrent yok) bu çizginin güvenli tarafında. Beam/P2P eklerken de aynı
çizgi korunacak: eşleştirilmiş KENDİ cihazların arasında transfer, içerik indeksi yok.

### Faz 4 — WebRTC P2P (OS bağımsız)

Evet, OS bağımsız: WebRTC tarayıcıda çalışır (Chrome/Firefox/Safari, Android/iOS/
masaüstü). Karşı taraf uygulama kurmaz, bir web sayfası açar.

**Kopmaya dayanıklı devam — mimarimiz buna zaten hazır:**
Ruu'nun motoru "ack'lenmiş aralık günlüğü + OPFS positioned write" üzerine kurulu.
P2P'de aynı model uygulanır: gönderen dosyayı sabit boyutlu parçalara böler, alıcı
her parçayı OPFS'e KENDİ ofsetine yazar ve ack'ler; bağlantı koptuğunda alıcı
"bende olmayan aralıklar" listesini gönderir, gönderen sadece onları yollar.
- Parça boyutu: 64-256 KB (DataChannel mesaj sınırı ve ack maliyeti dengesi)
- Akış kontrolü: `bufferedAmountLowThreshold` (backpressure — motorumuzdaki
  reader-park mantığının WebRTC karşılığı)
- Kimlik: dosya hash'i (SHA-256) + boyut → yeniden bağlanınca aynı transfer tanınır
- Yeniden bağlanma: ICE restart; sinyalleşme rölesi zaten var (Beam Worker)
- Doğrulama: parça bazlı hash → sessiz bozulma imkânsız

### Faz 5 — QR optik akış (Nadir'in fikri) — GERÇEK ama nişi farklı

Fikir gerçek ve sahada uygulanmış: animasyonlu QR + **fountain code** (kayıp
toleranslı kodlama; ACK gerekmez, alıcı yeterince kare toplayınca dosyayı kurar).
2026 ölçümleri: 60 FPS ekran → **~128 KB/s elde tutarken, ~190 KB/s sabitlenmiş**
cihazlarda (önceki nesil ~4 KB/s'e göre 30 kat sıçrama).

**Ama hız karşılaştırması acımasız:**

| Yol | Gerçekçi hız | 1 GB dosya |
|---|---|---|
| QR optik akış (60 FPS, fountain) | ~0,13-0,19 MB/s | **~1,5-2 saat** |
| WebRTC (yerel ağ) | ~12-100 MB/s | ~10-90 saniye |
| USB-C kablo | ~300+ MB/s | ~3 saniye |

Fiziksel tavan: ekran tazeleme (60-120 Hz) × kare başına QR kapasitesi (v40-L
≈ 2,9 KB) × kamera decode başarımı. "Saniyede 100 kare" ekran+kamera senkronu ve
motion blur yüzünden pratikte 60'ı geçmez; 120 Hz ekran + 120 fps kamera ile
teorik 2 kat. Yani QR, P2P'den HIZLI OLAMAZ — fizik izin vermiyor.

**QR'ın gerçek üstünlüğü hız değil, BAĞIMSIZLIK:** ağ yok, eşleştirme yok, hesap
yok, Bluetooth yok, izin yok (kamera hariç), tam air-gap, tam gizlilik. Doğru
kullanım alanları:
1. **Beam eşleştirmesi** (birkaç yüz byte) — anında, mükemmel uyum ✓ (planda)
2. Küçük dosya/metin/anahtar aktarımı (<5 MB) — kabul edilebilir süre
3. Ağın olmadığı/yasak olduğu ortamlar (hava boşluklu sistemler, kısıtlı kurum ağı)

**Doğru mimari = ikisi birlikte:** QR ile EŞLEŞTİR (saniyeler, sıfır altyapı) →
WebRTC ile AKTAR (hızlı). PairDrop dahil olgun çözümler bu kalıbı kullanıyor.
Ruu'da: panelde QR → telefon okur → WebRTC kurulur → büyük dosya uçar; ağ yoksa
kullanıcıya "QR akışına düş" seçeneği (yavaş ama çalışır) sunulur.


## Faz 5 derinleşmesi — "QR yoğunluğunu artırabilir miyiz?" (2026-08-02)

Hesap aracı: `node beam/qr-capacity.mjs` (parametreleri değiştirip denenebilir).

### Fikirlerin bilgi-teorisi süzgecinden geçmiş hali

| Fikir | Gerçek etki | Neden |
|---|---|---|
| **Renk katmanları (RGB)** | **≈3× — GERÇEK ÇARPAN** | Her modül 3 bağımsız kanalda bit taşır. HCC2D ölçümü: 15.048 bit/inç² (renkli) vs 5.016 (mono). Bedeli: %15-38 çözme maliyeti + kalibrasyon paleti yer kaplar, otomatik beyaz dengesi bozabilir |
| **Modül başına çok seviye** (4 gri/parlaklık seviyesi) | ≈2× | Her modül 1 yerine 2 bit. SNR'ye çok duyarlı, blur'da ilk bozulan |
| **Yüksek kare hızı** (60→120 Hz ekran + 120 fps kamera) | ≈2× | Doğrudan zaman ekseninde çarpan |
| **QR'ı büyütmek** | ~1× (sınırda) | Duvar kamera: her modüle ≥2-3 kamera pikseli gerekir (Nyquist). 1080p ile ~200-330 modül tavanı; QR v40 zaten 177. 4K kamera ile ~2× açılabilir |
| **Ekranı bölgelere ayırmak** | **1× (kazanç yok)** | Toplam piksel alanı sabit; her parça kendi hizalama desenini tekrar eder → net KAYIP. Kazancı hızda değil dayanıklılıkta |
| **QR'ın yönü (4 yön)** | **+2 bit/kare (çarpan DEĞİL)** | Bir sembolün taşıdığı bilgi = log2(durum sayısı). 4 yön = 2 bit. Kare zaten ~23.600 bit taşıyor → katkı %0,008 |
| **"30 kareyi birleştirmek"** | **1× (zaten öyle çalışıyor)** | Fountain code tam olarak bunu yapar: kareler tek bir dosyanın kodlanmış parçalarıdır, alıcı yeterince kare toplayınca kurar. Kare *sayısı* zaten çarpan; aynı kareleri "birleştirmek" ek bilgi üretmez — bilgi kaynağı ekranın taşıdığı bit sayısıdır |

**Kritik ayrım:** çarpan olan şey **sembol başına ayırt edilebilir durum sayısını**
artıran her şeydir (renk, seviye, modül sayısı, kare sayısı). Yön/rotasyon gibi
"kare düzeyinde etiketler" toplanır, çarpılmaz.

### Bileşik tavan (hesaplandı)

| Senaryo | Hız | 1 GB |
|---|---|---|
| Bugünkü tipik (mono, 30 fps, elde) | 63 KB/s | 4,6 saat |
| Sahada ölçülen rekor (mono, 60 fps, sabit) | 142 KB/s | 2,1 saat |
| + renk (3×) | 401 KB/s | 44 dk |
| + renk + 120 Hz | 755 KB/s | 23 dk |
| + renk + 120 Hz + 4 seviye | 1,3 MB/s | 13 dk |
| Laboratuvar tavanı (bozulma sıfır) | 1,8 MB/s | 9 dk |
| **WebRTC yerel ağ** | **12-60 MB/s** | **~1 dk** |

Literatürle tutarlı: bir çalışma bozulma giderildiğinde **7,67 Mbps** ulaşılabilir
kapasite ölçmüş (~960 KB/s) — bizim "renk + 120 Hz" satırımızla aynı mertebede.

**Sonuç:** fikirler doğru yönde ve bileşik **~5-10× kazanç** gerçekçi. Ama optik
kanal, radyo kanalının ~50 katı dar kalmaya devam ediyor. QR akışı "P2P'den hızlı"
olamaz; değeri **sıfır altyapı + air-gap gizliliği**.

### Kendi format fikrimiz — ne zaman mantıklı?

Kendi kod formatımızı yazmak (renk + seviye + fountain, QR'ın hizalama israfı
olmadan) teorik ~3-6× getirir. Ama: ISO QR'ın olgun çözücüleri (BarcodeDetector
donanım hızlandırmalı) yerine kendi çözücümüzü yazmak demek — JS/WASM'da 120 fps
çözme ciddi iş. Karar: **v1'de standart QR** (eşleştirme için fazlasıyla yeterli),
kendi format Ar-Ge'si ayrı bir yan proje olarak değerlendirilir.

### Ruu için pratik plan (değişmedi)

1. QR = **eşleştirme kanalı** (birkaç yüz byte, anında, sıfır altyapı) ✓
2. WebRTC = **veri kanalı** (büyük dosyalar)
3. Ağ hiç yoksa → QR akışına düş (küçük dosyalar, renk katmanı v2'de)


## KARAR (2026-08-02): QR = veri kanalı DEĞİL, kontrol kanalı

Nadir kararı: "QR ile veri aktarımı konusunu kapatalım, gerek yok. QR ile p2p
başlatma, senkron etme ya da veri doğrulama gibi şeylere bakalım."

Hesap zaten bunu söylüyordu: en iyi ihtimalle ~1,8 MB/s, WebRTC 12-60 MB/s.
Dosya taşımak için QR yazmak, kazanmayacağımız bir yarışa girmek olurdu.
**Kapsam dışı:** fountain-coded QR dosya akışı, renkli/çok katmanlı kod Ar-Ge'si,
kendi kod formatımız.

### QR'ın üç kalıcı rolü (hepsi küçük veri → QR'ın güçlü olduğu yer)

**1. P2P başlatma (sinyalleşme)**
WebRTC bağlantısı için gereken SDP teklifi birkaç KB — QR'a sığar. Bu, klasik
"sinyalleşme sunucusu" bağımlılığını azaltır:
- PC panelde teklifi (sıkıştırılmış SDP + ICE adayları) QR olarak gösterir
- Telefon okur, cevabını üretir
- Cevap dönüşü: telefonda ekran var ama PC'de kamera olmayabilir → cevap
  röleye POST edilir (birkaç yüz byte, zaten canlı olan Beam Worker'ı kullanır)
- Sonuç: **hassas veri (anahtar/SDP) hiçbir zaman düz metin olarak röleye gitmez**;
  röle yalnızca şifreli cevabı taşır

**2. Eşleştirme ve senkron**
Bugünkü Beam modeli: QR = `relay + pairId + AES-GCM anahtarı`. Tek okutmada iki
cihaz kalıcı olarak eşleşir; anahtar hiçbir sunucuya gitmez. Cihaz listesi,
tercih senkronu gibi küçük durum aktarımları da aynı kanaldan.

**3. Veri doğrulama (SAS — kısa doğrulama dizesi)**
Transfer bittiğinde iki taraf dosya hash'inin (SHA-256) kısaltılmış halini
gösterir; QR ya da 4-6 karakterlik kod olarak karşılaştırılır. Bu, ortadaki-adam
saldırısına karşı insan-doğrulamalı katman ekler (magic-wormhole'un PAKE modeliyle
aynı fikir). Ayrıca transferin bütünlüğünü kullanıcıya görünür kılar.

### Beam mimarisi (güncel)

```
Telefon (PWA)                    Röle (CF Worker)              PC (uzantı)
  QR okut  ─────────────────────────────────────────────►  QR göster (eşleştirme)
  link paylaş → AES-GCM ile mühürle → POST /p/:id ──────►  alarms ile yokla
                                                            → çöz → indirme kuyruğu
  (Faz 4) WebRTC: SDP teklifi QR'dan, cevap röleden ────►  DataChannel → dosya
```


## P2P teknik araştırma sonuçları (2026-08-02) — uygulama kararları

Derin araştırma + özgün ölçümler. Tam rapor: bu bölüm + `beam/qr-capacity.mjs`.

### KARAR 1 — Sinyalleşme: KV DEĞİL, Durable Object

**Mevcut Beam rölesi KV kullanıyor ve WebRTC için YETERSİZ:** Cloudflare KV free
tier'da **1.000 yazma/gün** ve **aynı anahtara saniyede 1 yazma** sınırı var.
Trickle ICE saniyede birden fazla aday üretir → limite çarpar.
→ **Faz 4a: Durable Object + WebSocket Hibernation'a taşı** (2025-04'ten beri
ücretsiz planda; hibernasyonda süre faturalanmıyor; ~83.000 eşleşme/gün kapasite).
Mevcut düşük hacimli link-beam işi KV'de kalabilir.

### KARAR 2 — DataChannel parametreleri (kaynak koddan doğrulandı)

- **Chunk = 64 KiB** (`Math.min(pc.sctp.maxMessageSize, 65536)`). 256 KiB seçilmez:
  Chrome'da RFC 8260 interleaving **kapalı** (`enable_message_interleaving = false`),
  büyük mesaj association'ı ~220 fragment boyunca tekelleştirir.
- **`bufferedAmountLowThreshold ≥ 128 KiB` + setTimeout polling fallback.**
  TUZAK: Blink `bufferedAmount`'ı **100 KiB granülariteli** güncelliyor
  (`sctp_data_channel.cc`), daha düşük eşikte olay HİÇ gelmeyebilir → kilitlenme.
  Resmi WebRTC örneği bile bunu workaround yorumuyla kabul ediyor.
- **Uygulama katmanı stop-and-wait ACK KULLANMA.** PairDrop'un 300-400 KB/s'te
  takılmasının sebebi bu; `bufferedAmount` backpressure + 4-8 MB'da bir checkpoint.
- Gerçekçi tavan: **~30 MB/s** (Chrome IPC/kripto darboğazı; aynı yığın native'de
  >1 Gbps yapıyor). Paralel DataChannel hızlandırmaz — SCTP cwnd association başına.

### KARAR 3 — Resume: kendi aralık günlüğümüz (croc'un heuristiği DEĞİL)

croc "eksik parça"yı **tamamen sıfır blok** heuristiğiyle buluyor → meşru sıfır
dolu chunk gereksiz yeniden gönderiliyor. Ruu'nun `mergeRange()` + `ranges` modeli
zaten daha doğru; P2P'de aynen kullanılacak. Parça başına SHA-256 **bedava**:
ölçüm 1.160 MB/s (64 KiB chunk) — WebRTC tavanının 40 katı.

### KARAR 4 — ICE restart DataChannel'ı KAPATMAZ

RFC 8831 §5: ICE/UDP katmanı IP değişimini DTLS/SCTP'ye dokunmadan halleder.
→ Yeniden bağlanmada **yeni kanal açma**, mevcut kanalı kullan.
TURN gereksinimi: kullanıcıların ~%22'si relay gerektiriyor (2016 callstats, hâlâ
en iyi birincil veri); mobilde %40 symmetric NAT. Cloudflare Realtime TURN:
**1.000 GB/ay ücretsiz**, sonrası $0,05/GB (yalnız egress).

### KARAR 5 — MV3 barındırma: offscreen `WEB_RTC` reason

`chrome.offscreen` reason listesinde **WEB_RTC var ve ömür SINIRSIZ** (yalnız
AUDIO_PLAYBACK 30 sn'de kapanır). Bonus: aktif RTCPeerConnection olan sayfa
**intensive timer throttling'den muaf**. Ruu'nun offscreen motor mimarisiyle
birebir örtüşüyor. CSP'ye `'wasm-unsafe-eval'` açıkça yazılacak.

### KARAR 6 — Kütüphaneler (sıfır CDN, hepsi pakette)

| İş | Seçim | Gerekçe |
|---|---|---|
| QR encode | nayuki qrcodegen (MIT, 4,1 KB gzip) | Şu an `qrcode-generator` kullanılıyor; eşdeğer, değişim şart değil |
| QR decode | **zxing-wasm** (MIT, 447 KB gzip) | Ölçüm: jsQR'dan **6-78× hızlı**; gürültülü 720p'de jsQR 560 ms (1,8 fps) → akış için kullanılamaz |
| BarcodeDetector | yalnızca opsiyonel hızlı yol | **Chrome masaüstünde SADECE macOS/ChromeOS'ta var** — Windows/Linux'ta YOK |
| WebRTC sarmalayıcı | **YOK, ham API** | simple-peer 2024'ten beri güncellenmiyor + 6 bağımlılık; peerjs 16.300 B chunking dayatıyor |
| PAKE | **YOK** | QR zaten 256-bit rastgele anahtar taşıyor; PAKE düşük entropili parola içindir |
| Doğrulama | SAS (kısa doğrulama dizesi) | DTLS fingerprint hash'inden 4-6 hane, WebCrypto ile ~10 satır |

**Lisans uyarısı:** PairDrop ve Snapdrop **GPL-3.0** → Ruu MIT olduğu için
**kod kopyalanmayacak**, yalnızca protokol fikirleri. croc/FilePizza/Decimen MIT/BSD.

### KARAR 7 — QR kamera erişimi tam sekmede

`getUserMedia()` offscreen document'ta çalışmaz (izin yüzeyi yok); side panel ve
popup da güvenilir değil. → QR okuyucu gerekirse `chrome.tabs.create('scanner.html')`.
Bizim akışımızda kamera **telefonda** (PWA) olduğu için bu sorun Faz 5'e kadar yok.

### Faz sırası (güncellendi)

1. **4a** Sinyalleşme: KV → Durable Object + WebSocket
2. **4b** WebRTC DataChannel (64 KiB, 128 KiB eşik, mergeRange resume, parça SHA-256)
3. **4c** TURN (Cloudflare Realtime, ephemeral credential)
4. **5a** QR eşleştirme genişletme (ICE ufrag+pwd taşı — HKDF ile TÜRETME:
   SDP munging yasaklanıyor, Chrome PSA 2025-04)
5. **5b** QR akış: kapsam dışı (Nadir kararı) — yalnızca kontrol kanalı
