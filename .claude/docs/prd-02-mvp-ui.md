# PRD — Parça 2: MVP Özellik Listesi + Side Panel UI Eskizi

> Durum: ONAY BEKLİYOR (Nadir) · 2026-07-30
> Bağlam: prd-01-architecture.md (ONAYLANDI) · Test kuralı: hiçbir özellik testsiz kapanmaz

## 1. MVP Özellikleri (kabul kriterli)

| # | Özellik | Kabul kriteri | Test |
|---|---|---|---|
| F1 | **İndirme devralma** | Tarayıcı indirmesi başlar → Ruu iptal edip devralır. Ayarlardan kapatılabilir; eşik altı dosyalar (varsayılan <10 MB, ayarlanabilir) native kalır | cdpilot E2E |
| F2 | **Segmentli motor** | 1-8 bağlantı; first-fit + work-stealing (boş bağlantı en büyük in-flight segmenti böler); `Accept-Ranges` yoksa native'e zarif düşüş | Unit + throttled sunucu entegrasyon |
| F3 | **Pause/Resume + crash kurtarma** | Tarayıcı yeniden başlatılsa bile kaldığı yerden; ETag/Last-Modified değiştiyse kullanıcıya "dosya değişmiş, baştan?" sorusu | Entegrasyon (sunucu kill/restart senaryosu) + cdpilot E2E |
| F4 | **Kayıt yeri** | İş eklenirken seçilir (FSA) YA DA varsayılan Downloads teslimi; son klasör hatırlanır | cdpilot E2E |
| F5 | **Side Panel** | Aktif/tamamlanan listesi, canlı segment haritası, hız+ETA, URL yapıştırarak ekleme | cdpilot E2E + component unit |
| F6 | **Hata yönetimi** | Bağlantı başına retry (max 10, sequential-fail sayacı); anlaşılır hata durumu; bitti/hata bildirimi. Silent catch YASAK (gate) | Unit + hata-enjeksiyonlu entegrasyon |
| F7 | **Ayarlar** | Varsayılan bağlantı sayısı, devralma eşiği, tema (light/dark/auto) | Component unit |
| F8 | **Sağ-tık "Ruu ile indir"** | Link/görsel context menu → işi kuyruğa ekler | cdpilot E2E |

MVP dışı (Faz 2+): çoklu kuyruk UI, zamanlama, resolvers, mail butonu, bant genişliği limiti.

## 2. Side Panel Eskizi

```
┌──────────────────────────────────┐
│ ◈ Ruu            ⏸ tümü   ⚙      │  ← header: logo, global pause, ayarlar
├──────────────────────────────────┤
│ [ URL yapıştır veya sürükle    + ]│  ← ekleme alanı (her zaman üstte)
├──────────────────────────────────┤
│ AKTİF (2)                        │
│ ┌──────────────────────────────┐ │
│ │ ubuntu-24.04.iso      2.1 GB │ │
│ │ ▰▰▰▰▰▱▱▰▰▰▱▱▱▱▱▱  46%        │ │  ← canlı segment haritası
│ │ 18.4 MB/s · 1dk 12sn  ⏸  ✕   │ │     (segment=blok; dolu/boş/aktif)
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ dataset.zip            418 MB│ │
│ │ ▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱  82%        │ │
│ │ 9.1 MB/s · 8sn        ⏸  ✕   │ │
│ └──────────────────────────────┘ │
├──────────────────────────────────┤
│ TAMAMLANAN (12)            ˅     │  ← katlanır; dosya aç / klasörde göster
└──────────────────────────────────┘
```

**Tasarım dili:** sıcak-karanlık editorial ton (light tema eş öncelikli), 3 katmanlı CSS
token (primitive→semantic→component, hardcoded hex yasak), inline SVG ikon (emoji yasak),
tek ekrana sığan taşmasız layout. Segment haritası ürünün imza görseli — IDM'in mozaik
göstergesinin modern, sakin hali (animasyon: yalnızca aktif segment ucunda hafif nabız,
prefers-reduced-motion'a saygılı).

**Durum renkleri (semantic):** indirme=accent, pause=muted, hata=danger, tamam=success.

## 3. Test Altyapısı (MVP ile birlikte kurulur, sonra değil)

1. **Vitest** — motor birimleri: allocator (first-fit + work-stealing), retry sayacı,
   ranges birleştirme, ETag doğrulama. Hedef: motor çekirdeği ≥%90 satır kapsaması.
2. **Throttled Range sunucusu** (`test/server/`) — TDM `server/` pattern'i: hız limiti,
   206/Content-Range, kasıtlı fazla-byte dönen quirk modu, kesinti enjeksiyonu.
3. **cdpilot E2E** (`test/e2e/`) — unpacked uzantı yüklü Chromium: devralma, panel akışı,
   pause/resume, crash kurtarma senaryoları. Her deploy/PR öncesi smoke.
