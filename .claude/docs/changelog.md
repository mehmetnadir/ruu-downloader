# Changelog

Sürümler `package.json`'dan; yardımcı uygulama ayrı sürümlenir (`helper-v*`).

## v0.6.4 — 2026-08-24
- **fix(takeover): WeTransfer indirmeleri ölüyordu — ÖN-UÇUŞ eklendi.** Kök neden
  canlı doğrulandı: WeTransfer indirmeyi `POST /api/v4/transfers/<id>/download`
  ile doğuruyor; DownloadItem adresi taşır ama yöntemi taşımaz. Devralma aynı
  adrese GET atınca 404, native'e düşünce Chrome da GET ile gidip
  `SERVER_BAD_CONTENT` alıyordu. Sıra yanlıştı: Chrome'un ÇALIŞAN indirmesi
  yerine geçebileceğimiz KANITLANMADAN iptal ediliyordu. Artık iptalden önce
  tek baytlık Range isteği; adres bize kapalıysa native indirmeye DOKUNULMAZ
  (teşhis günlüğünde `unfetchable`). E2E S24
- **fix(native):** Range desteklemeyen sunucuda kullanıcının kaydetme
  penceresinde seçtiği ad kayboluyordu (`downloads.download({url})` çağrısında
  `filename` hiç geçilmiyordu). Ayrıca `downloads.download({filename})` TEK
  BAŞINA yetmiyor: Chromium'da Content-Disposition öneriyi eziyor — ad artık
  `downloads.onDeterminingFilename` ile dayatılıyor. E2E S21
- **fix(history):** native indirmelerde boyut 0 kaydediliyordu ("0 B" satırları);
  gerçek boyut Chrome'un kaydından alınıyor, istatistiğe de giriyor
- **feat(panel): geçmiş ve "Tamamlanan" listesi için sıralama.** Kartlar bir kez
  eklenip bir daha yerleşmiyordu (sıra "ne zaman taşındı"ydı, "ne zaman indi"
  değil). Varsayılan en yeni önce; tarih/ad/boyut seçenekleri kalıcı. Türkçe
  harmanlama + insan sayı sırası ("alfa (2)" < "alfa (10)"). E2E S23
- **feat(takeover): Cmd/Ctrl/Alt + tık = tarayıcı indirsin.** İçerik betiği
  DİNAMİK kayıtlı: ayar kapalıysa hiçbir siteye enjekte edilmez. E2E S22
- **fix(diag):** hata kartı artık teknik sebebi de yazıyor ("tüm bağlantılar
  düştü · HTTP 403") — "Takıldı" tek başına ne kullanıcıya ne bize yol
  gösteriyordu
- **test(e2e):** indirme dizini CDP yerine profil tercihinden geliyor.
  `Browser.setDownloadBehavior` Chrome'un ad belirleme yolunu baypas ediyor ve
  `onDeterminingFilename` hiç çalışmıyordu — ad testleri gerçeği ölçemiyordu.
  Ayrıca koşum varsayılan HEADLESS (görünür için `HEADLESS=0`)

## v0.6.3 — 2026-08-16
- **fix(build):** dist manifest'i her build'de gerçek sürümü taşır (dev build hep
  0.0.1 gösteriyordu — kod günceldi, etiket yanlıştı)
- **fix(takeover):** kaydetme penceresi seçimi çöpe gidiyordu. Devralma artık
  dosya adı belirlenene kadar bekler; kullanıcının seçtiği ad+klasör `forcedName`
  olarak zincire girer, sunucu başlığını ezer, teslimde pencere 2. kez açılmaz
- **feat(panel):** her kartta "URL kopyala" butonu (inen/biten/hatalı)

## v0.6.2 — 2026-08-07
- **feat(status):** araç çubuğu ikonu yardımcı durumunu gösterir (ters renk =
  yardımcı bağlı) + options'ta 3 durumlu bant, OS'e göre kurulum tarifi
- **feat(options):** ayarlar tam sayfaya taşındı (`options_ui`); panel yalnız izleme
- **feat:** kaydetme yeri Chrome ayarına bırakıldı (ölçüldü); tür klasörleri opt-in

## v0.6.x — 2026-08-04/05
- **feat(helper):** isteğe bağlı yerel yardımcı (Go, 5 platform). Host başına 6
  bağlantı sınırını ve tarayıcı-kapanınca-durma kısıtını kaldırır. Motora bağlandı,
  gerçek zincirle doğrulandı. İzinler optional_permissions
- **feat(engine):** kuyruk mekanizması (eşzamanlılık sınırı, FIFO, sıra rozeti)

## v0.6.1 — 2026-08-03
- **fix(filename):** sunucu adı temizlenmiyordu — Türkçe İ + görünmez karakter
  yüzünden 1,5 GB'lık indirme teslim edilemedi. Chromium kural setine göre
  temizleyici + teslimde geri çekilme zinciri

## Yardımcı uygulama
### helper-v1.0.1 — 2026-08-08
- **fix:** `loadJournal` kilitsiz yazıyordu (CI race detector yakaladı)
### helper-v1.0.0 — 2026-08-07
- İlk sürüm: fırlatıcı/sunucu ayrımı, ranged fetch + konumlu yazma, aralık
  defteri, idle self-shutdown, yalnız-loopback + token + CORS/PNA
