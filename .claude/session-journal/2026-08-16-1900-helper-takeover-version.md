# Oturum: 2026-08-16 19:00 — Yardımcı uygulama uçtan uca, devralma düzeltmeleri, sürüm damgası

Uzun bir yay: yerel yardımcı uygulamanın tasarımı → yazımı → motora bağlanması →
gerçek zincirle kanıtlanması, arada iki saha hatası ve bir açık vaka.

## Yapılanlar

- **Kuyruk mekanizması** (`src/engine/queue.ts`) — eşzamanlılık sınırı, FIFO,
  'queued' durumu, panelde sıra rozeti. Yerel program GEREKTİRMEZ.
  E2E S16 (limit=1'de 3 iş, sınır ihlali gözlenmedi).
- **Yerel yardımcı uygulama** (`helper/`, Go, ~6 MB, 5 platform) — commit `2faa3c7`.
  Tasarım ekseni: yardımcı APTAL, tüm zekâ eklentide. Açtığı iki kapı:
  host başına 6 bağlantı sınırı (Chromium sabiti) ve tarayıcı kapandıktan sonra
  devam. Güvenlik testlerle kilitli: yalnız loopback, sabit-süreli token,
  dizin kaçışı engeli, bağlantı tavanı 32, auto-update/telemetri YOK.
- **Yardımcı motora bağlandı** — commit `53c2276`. Doğrulama: `test/field/helper-real.sh`
  (enjeksiyonsuz gerçek zincir) → connectNative → fırlatıcı → bağımsız sunucu →
  motor devri → dosya `~/Downloads`'a, 9 MB bayt doğrulandı.
- **FIRLATICI/SUNUCU AYRIMI** (asıl mimari düzeltme) — commit `d2b38b9`.
  Kök neden: Chrome, native-messaging kanalı kapanan host sürecini ÖLDÜRÜR.
  SW el sıkışmayı alır almaz kanalı kapatınca sunucu ölüyordu; health çağrısı
  yarışı kazanıp geçiyor, saniyeler sonraki iş devri "Failed to fetch" alıyordu.
  "Tarayıcı kapansa da sürsün" vaadi de aynı sebeple imkânsızdı.
  Fix: Chrome'un başlattığı süreç artık fırlatıcı; sunucuyu bağımsız oturumda
  (setsid / DETACHED_PROCESS) başlatır, adresi endpoint dosyasında paylaşır, çıkar.
  Sunucu 15 dk boşta kalınca kendini kapatır. O_EXCL kilidi çift sunucuyu önler.
- **Yardımcı race düzeltmesi** — commit `ecc1aa0` (v1.0.1). `loadJournal` kilitsiz
  yazıyordu; CI'ın Linux race detector'ı yakaladı, lokalde zamanlama hiç tutmadı.
- **helper-v1.0.1 release YAYINDA** — 5 platform ikilisi + CHECKSUMS.txt.
  Kurulum komutu birebir doğrulandı: macOS arm64 (taze HOME, sağlama doğrulama,
  temiz kaldırma) ve Linux amd64 (Docker, bash'sız minimal imaj, sh ile).
- **Ayarlar tam sayfaya taşındı** (`options_ui`) — commit `d40ba20`. 2 sütunlu
  kart ızgarası, 28 servis 3 sütun. Panel artık yalnız izleme. E2E S18.
- **İkon = durum göstergesi** — commit `3ff5f4b`. Amber zemin = tarayıcı motoru,
  ters renk = yardımcı bağlı. SW /health ile 1 dk'da bir doğrular (ikon yalan
  söylemesin). Options en üstünde 3 durumlu bant + OS'e göre kurulum komutu.
- **SAHA HATASI: kaydetme penceresi seçimi çöpe gidiyordu** — commit `5ba6095` (v0.6.3).
  Devralma onCreated ANINDA iptal ettiği için kullanıcının pencerede seçtiği
  klasör+isim ölü item'a gidiyordu. Fix: devralma filename belirlenene kadar
  ertelenir (pendingTakeover + onChanged), o ad `forcedName` olarak zincire girer,
  probe tahminini ezer, teslimde saveAs:false. E2E S19.
- **URL kopyala butonu** — her kartta (inen/biten/hatalı). E2E S20.
- **Dev build sürüm damgası** — commit `04bec93`. `dist` hep 0.0.1 gösteriyordu;
  build.mjs artık her koşumda package.json sürümünü damgalar + denetim kontrolü.

## Yapılamayanlar / Yarım Kalanlar

- **WeTransfer "Takıldı" — AÇIK VAKA, kök neden YOK.** Nadir'in gerçek linkiyle
  9 reprodüksiyon koşumu yaptım; kendi otomasyonumda indirme HİÇ doğmadı
  (isTrusted:false tıklar reddediliyor olabilir; trusted mouse event koşumu
  ortamda asıldı). Bekleyen: Nadir'in kartındaki hata DETAY metni —
  errAllDown / errChanged / errDelivery ayrımını yapacak.
- **Windows `install.ps1` doğrulanmadı** — test ortamı yok. Mantık hazır
  (hazır ikili + SHA-256), ilk Windows kullanıcısı test edilmemiş halka.
- **"Sor" penceresi gerçek akış testi** — CDP kaydetme penceresini simüle
  edemiyor; S19 vekil sinyalle test ediyor, gerçek akış Nadir'de doğrulanmalı.

## Konuşulup Ertelenenler

- Faz 4a: Beam rölesi KV → Durable Object (KV limitleri WebRTC sinyalleşmesini
  kaldırmaz: 1000 yazma/gün, 1 yazma/sn/anahtar)
- Faz 4b: WebRTC P2P (64 KiB chunk, ≥128 KiB eşik, mergeRange resume, parça SHA-256)
- Toplu indirme (DownThemAll 2025'te Chrome'dan düştü, ~200K kullanıcı boşta)
- Zamanlama UI ("gece 02:00'de başla" — kuyruk var, zamanlayıcı yok)
- Panel içi dosya önizlemeleri
- aria2 isteğe bağlı arka uç (kendi ikilimiz yapıldığı için önceliği düştü)

## Kararlar ve Gerekçeleri

- **Kendi ikilimiz, aria2 değil** — aria2 kendi indirme stratejisini uygular;
  adaptif rampa, çökme-devam günlüğü, link kurtarma, Gmail akışı oraya geçmez ve
  eklenti merkez olmaktan çıkardı (Nadir'in açık hedefinin tersi).
- **Yardımcı APTAL olmalı** — tüm strateji eklentide. "Nadiren güncellenir"
  hedefinin SONUCU bu: rampa iyileşince ikili sürümü değişmez.
- **Zorunlu kurulum HAYIR, isteğe bağlı EVET** — Aria2 Explorer (kurulum ister)
  80K kullanıcı, Chrono (saf eklenti) 800K. 10× fark; kurulum sürtünmesi ölçülü.
- **Auto-update YOK** — en büyük kötü-yazılım vektörü ve "nadiren güncellenen"
  hedefiyle çelişir. Güven, yeniden üretilebilir derleme + yayınlanan sağlama ile
  kurulur; marka vaadiyle değil.
- **İzinler optional_permissions** — yardımcıyı istemeyen kullanıcı hiç vermez;
  CORS + PNA sayesinde host izni hiç gerekmedi.
- **Tahmin yaması YASAK** — WeTransfer'de kök neden bilinmeden düzeltme yapılmadı.

## Gelecek Oturum İçin

1. **WeTransfer vakası**: Nadir'in hata detay metnini al → kök nedeni kilitle →
   hedefli düzeltme. Şüphe (doğrulanmamış): v0.6.3 devralma-ertelemesi ×
   WeTransfer'in tek-kullanımlık imzalı URL'i → 403 → errAllDown.
2. **Faz 4a**: Beam rölesi KV → Durable Object göçü (`beam/worker.js`).
3. Toplu indirme + zamanlama UI (kuyruk altyapısı hazır, ucuz).
4. Nadir'e kilitli: Windows kurulum testi, v0.6.3 CWS yüklemesi, CWS dashboard
   (görseller + kategori + gizlilik formu; metinler `store-listing.md`'de hazır).

## Açık Riskler / Dikkat

- WeTransfer akışı DEĞİŞMİŞ: onay → abonelik satış ekranı → "İndirmeye devam et"
  / "Atla ve indirmeye git" → indirme. A/B varyantları var (sıra ve metin
  koşumlar arası değişiyor). Yerel simülasyon sayfamız (S8/S9) bu ara adımı
  içermiyor — güncellenmeli.
- Offscreen belge ömrü hâlâ en kırılgan bağımlılığımız (Chrome kısıtlamayı planlıyor).
- CWS öğesi `kcbcgiflgolgekfpgijpjeonjfjpcdid` incelemede, YAYINDA DEĞİL.
  Yeni sürüm yüklemek inceleme sırasını sıfırlar — karar Nadir'de.

## Ortam Durumu

- **Deploy:** Eklenti mağazaya yüklenmedi (Nadir'in kararı bekliyor);
  `out/ruu-downloader-v0.6.3.zip` paketlenmiş hazır. helper-v1.0.1 GitHub
  release'i YAYINDA ve doğrulandı. Beam rölesi canlı
  (`ruu-beam.nadir-zai-proxy.workers.dev`), bu oturumda dokunulmadı.
- **Gate durumu:** 136 unit · 20/20 E2E · 22 Go testi (race) · denetim temiz.
- **Nadir'in makinesi:** ruu-helper v1.0.1 kurulu ve Chrome'da BAĞLI doğrulandı.
- **Arka plan işleri:** yok.
