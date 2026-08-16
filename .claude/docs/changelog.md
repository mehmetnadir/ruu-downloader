# Changelog

Sürümler `package.json`'dan; yardımcı uygulama ayrı sürümlenir (`helper-v*`).

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
