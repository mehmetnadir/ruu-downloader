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
