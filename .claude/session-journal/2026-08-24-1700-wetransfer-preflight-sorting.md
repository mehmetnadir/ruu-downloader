# Oturum: 2026-08-24 17:00 — WeTransfer kök nedeni, dosya adı, sıralama, tuş baypası

Nadir dört saha hatası bildirdi; dördü de kapandı. En değerli çıktı tek bir
düzeltme değil, **kök nedenin kanıtlanması**: WeTransfer'de neden indirme
yapılamadığı iki oturumdur bilinmiyordu, bu oturumda canlı olarak kilitlendi.

## Yapılanlar

- **WeTransfer "Takıldı" — KÖK NEDEN KANITLANDI + ön-uçuş eklendi.**
  Kanıt zinciri (cdpilot + Nadir'in gerçek linki, canlı):
  sayfa `GET /downloads/...` → **200** · WeTransfer'in kendi API'si
  `POST /api/v4/transfers/<id>/download` → **200**, `direct_link` (JWT ömrü 600 sn) ·
  o direct_link'e Range ile üst üste 3 istek → **206/206/206** (yani DOSYA linki
  sağlam ve yeniden istenebilir) · **`GET /api/v4/transfers/<id>/download` → 404.**
  Yani: WeTransfer indirmeyi bir POST ile doğuruyor; Chrome'un DownloadItem'ı
  adresi taşır ama YÖNTEMİ taşımaz. Devralma aynı adrese GET atınca 404 alıyor,
  native'e düşünce Chrome da GET ile gidip `SERVER_BAD_CONTENT` alıyordu.
  **Asıl hata sıradaydı:** Chrome'un ÇALIŞAN indirmesi, yerine geçebileceğimiz
  KANITLANMADAN `cancel()+erase()` ediliyordu — geri dönüşü yok, dosya buharlaşıyordu.
  Fix: `attemptTakeover` içinde iptalden ÖNCE tek baytlık Range ön-uçuşu
  (`src/sw.ts` `preflight()` + `src/engine/takeover.ts` `preflightVerdict()`).
  206 → tam devralma · 200 → devral, native'e düş · diğer her şey → **DOKUNMA**,
  teşhis günlüğüne `unfetchable` yaz. Doğrulama: E2E S24 (sunucu 2. isteğe 403
  veriyor; tarayıcının indirmesi hayatta kalıyor ve dosya bütün iniyor).
- **Dosya adı hatası — İKİ ayrı kusur.**
  (a) `native-fallback` dalında `chrome.downloads.download({ url })` çağrılıyordu,
  `filename` HİÇ geçilmiyordu; kullanıcının kaydetme penceresinde seçtiği ad
  (`forcedName`) sessizce düşüyor, Chrome sunucunun Content-Disposition'ına
  dönüyordu. Motor artık `forcedName`'i native-fallback mesajında da taşıyor.
  (b) `filename` geçmek TEK BAŞINA YETMİYOR: Chromium'un `net::GenerateFileName`
  sırası Content-Disposition'ı eklentinin `suggested_name`'inden ÖNCE koyar.
  Bunu E2E S21 yakaladı ("düzelttim" deyip geçecektik). Ad artık
  `chrome.downloads.onDeterminingFilename` ile dayatılıyor
  (`src/engine/native.ts` `pickNativeName` saf çekirdek + `src/sw.ts` I/O).
  Doğrulama: E2E S21 — `chromeAdı="benim-sectigim-ad.bin"`, sunucu adı yok.
- **Geçmiş + "Tamamlanan" sıralaması.** Kök neden: kartlar listeye bir kez
  `appendChild` ile giriyor ve BİR DAHA yerleşmiyordu — sıra "ne zaman indi"
  değil "ne zaman TAŞINDI"ydı. `render()` artık her çizimde DOM sırasını açıkça
  kuruyor. Geçmişe kalıcı sıralama seçici eklendi (tarih/ad/boyut, varsayılan
  en yeni önce; `src/engine/history.ts` `sortEntries`). Türkçe harmanlama +
  numeric collation: `ayak < Çankaya < keysil`, `alfa (2) < alfa (10)`.
  Doğrulama: E2E S23 + 11 unit.
- **Cmd/Ctrl/Alt + tık → tarayıcı indirsin** (Nadir'in isteği). İçerik betiği
  (`src/content/bypass.ts`) mousedown'ı yakalama fazında dinler, adresi SW'ye
  bildirir; SW 4 sn'lik tek kullanımlık işaret tutar (`src/engine/bypass.ts`,
  aynı köken şartı — alakasız indirme kaçmasın). Betik `scripting.registerContentScripts`
  ile **DİNAMİK** kayıtlı: ayar kapalıysa hiçbir siteye enjekte edilmez.
  Doğrulama: E2E S22 + 13 unit.
- **Teşhis: hata kartı artık teknik sebebi de yazıyor** (`errorDetail`).
  "Takıldı · tüm bağlantılar düştü" tek başına ne kullanıcıya ne bize yol
  gösteriyordu; `· HTTP 404` eklenince WeTransfer kök nedeni AYNI GÜN bulundu.
- **Native indirmelerde boyut 0 kaydediliyordu** → geçmişteki "0 B" satırları.
  Gerçek boyut Chrome'un kaydından (`fileSize`/`bytesReceived`) alınıyor ve
  istatistiğe de giriyor.
- **E2E ortam sahteliği düzeltildi (harness fidelity).** CDP
  `Browser.setDownloadBehavior`, Chrome'un hedef belirleme yolunu
  (`ChromeDownloadManagerDelegate`) baypas ediyor; `onDeterminingFilename` hiç
  tetiklenmiyordu ve ad testleri gerçeği ÖLÇEMİYORDU (S21 önce yanlış FAIL verdi).
  İndirme dizini artık `$PROFILE/Default/Preferences` ile ayarlanıyor, CDP
  override kaldırıldı. S17/S19/S21 artık gerçek adı doğruluyor.
- **Testler varsayılan HEADLESS** (Nadir'in isteği — görünür koşum çalıştığı
  Chrome pencerelerinin arasına giriyordu). Görünür için `HEADLESS=0 ./test/e2e/run.sh`.
- **Sürüm 0.6.4**, changelog + README rozetleri + `.claude/CLAUDE.md` tazelendi,
  `project-switch.md` 25 günlük bayatlıktan çıkarıldı (STATE/TEMPORAL/MAINTENANCE).

## Yapılamayanlar / Yarım Kalanlar

- **WeTransfer'i Ruu ile HIZLANDIRMA** — yapılmadı, bilinçli. Mümkün olduğu
  kanıtlı (direct_link Range destekliyor, 206×3). wetransfer.com'a küçük bir
  içerik betiği koyup API cevabındaki `direct_link`'i yakalayıp Ruu'ya vermek
  gerekiyor. Raporlanan 4 hatanın DIŞINDA yeni bir iş olduğu için onay istendi,
  Nadir cevap vermeden oturum kapandı.
- **Windows `install.ps1` doğrulaması** — hâlâ test ortamı yok (önceki oturumdan devreden).
- **"Sor" penceresinin GERÇEK akış testi** — CDP kaydetme penceresini simüle
  edemiyor; S19/S21 vekil sinyalle test ediyor. Gerçek akış Nadir'de doğrulanmalı.

## Konuşulup Ertelenenler

- Faz 4a: Beam rölesi KV → Durable Object
- Faz 4b: WebRTC P2P · toplu indirme · zamanlama UI
- v0.6.4'ün CWS'e yüklenmesi (inceleme sırasını sıfırlar — karar Nadir'de)

## Kararlar ve Gerekçeleri

- **Ön-uçuş, "akıllı tahmin" yerine.** Alternatif: POST ile doğan indirmeleri
  sezgisel olarak tanımaya çalışmak. Elendi — `DownloadItem` yöntemi taşımıyor,
  sezgi olurdu. Ön-uçuş tek gidiş-dönüş maliyetiyle KESİN cevap veriyor ve
  referer/çerez/süre dolması gibi tüm "bize kapalı" hâllerini aynı anda kapsıyor.
- **WeTransfer'de kenara çekilmek, zorla devralmaya tercih edildi.** O adresi
  yeniden isteyemiyoruz; ısrar etmek kullanıcının dosyasını öldürüyor. Dosyanın
  Chrome ile inmesi, Ruu kartı görünmemesinden daha değerli.
- **`onDeterminingFilename`, `download({filename})` yerine.** İkincisi Chromium'da
  Content-Disposition'a yeniliyor — E2E ile kanıtlandı, belge okumasıyla değil.
- **Aktif liste sıralanmıyor, sadece "Tamamlanan" sıralanıyor.** Aktif listedeki
  sıra kuyruğun kendisidir (FIFO); ada göre karıştırmak "sıradaki iş hangisi"
  bilgisini yok ederdi.
- **Baypas içerik betiği dinamik kayıtlı.** Manifest'e sabit `<all_urls>` betiği
  koymak izin minimalizmi doktrinini ("content script sadece mail domain'leri")
  ihlal ederdi. Dinamik kayıtla ayar kapalı kullanıcıda betik HİÇ yok.

## Gelecek Oturum İçin

1. **Nadir'in kararı: WeTransfer hızlandırma.** "Evet" derse: wetransfer.com'a
   içerik betiği (MAIN world fetch hook ya da indir düğmesine bağlanıp API'yi
   kendimiz çağırma), `direct_link` → Ruu. Kanıt hazır: 206×3.
2. **Nadir gerçek tarayıcıda v0.6.4'ü doğrulasın:** (a) WeTransfer indirmesi
   sağlam iniyor mu, (b) kaydetme penceresinde yazdığı ad korunuyor mu,
   (c) geçmiş sıralaması ve seçici, (d) Cmd/Ctrl/Alt + tık.
3. v0.6.4 CWS yüklemesi kararı (`./scripts/cws-publish.sh`, inceleme sıfırlanır).
4. Faz 4a: Beam rölesi KV → Durable Object.

## Açık Riskler / Dikkat

- **`onDeterminingFilename` her indirmede çalışır.** `maybeHasNativeNames` ipucu
  ile hızlı yola sapıyoruz; `true` döndüğümüz her durumda `suggest()` çağrılmak
  ZORUNDA, yoksa indirme sonsuza kadar hedef bekler. Kod bunu try/catch ile
  garantiliyor — buraya dokunan herkes bunu bozmasın.
- Ön-uçuş her devralmaya bir gidiş-dönüş ekliyor (6 sn tavan). Yavaş sunucuda
  devralma gecikir; zaman aşımında native'de kalır — güvenli taraf.
- Baypas işareti 4 sn ve aynı köken şartlı. Cmd+tık ile sekme açmak yaygın;
  yanlış pozitifin bedeli "indirme tarayıcıya gitti" (hafif ve geri alınabilir).
- Offscreen belge ömrü hâlâ en kırılgan bağımlılığımız (Chrome kısıtlamayı planlıyor).
- CWS öğesi `kcbcgiflgolgekfpgijpjeonjfjpcdid` incelemede, YAYINDA DEĞİL.

## Ortam Durumu

- **Deploy:** YAPILMADI ve gerekmedi. Eklenti mağazaya yüklenmiyor (Nadir'in
  kararı, inceleme sırasını sıfırlar); `out/ruu-downloader-v0.6.4.zip` paketlendi
  ve hazır. Beam rölesi canlı (`ruu-beam.nadir-zai-proxy.workers.dev`), bu oturumda
  DOKUNULMADI. helper-v1.0.1 GitHub release'i yayında, değişmedi.
- **Gate durumu:** tsc temiz · 181 unit PASS · **24/24 E2E PASS** · 22 Go testi
  (race) PASS · `node scripts/audit.mjs` → borç bulunamadı.
- **Arka plan işleri:** yok. cdpilot tarayıcısı kapatıldı.
