# PRD — Parça 3: Ürün Yol Haritası (Nadir'in istek listesi, 2026-07-30)

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

## Bu dalganın kapsamı (onaylı sayılır — Nadir talep etti)

1. Keyed renderer (animasyon sıfırlanma bug'ının kökten çözümü)
2. Kart mimarisi: metin önde, tüm kartın arka planı akan progress katmanı (shimmer sweep, GPU-safe translateX)
3. Kalp atışı: aktif indirme noktası (double-thump, 1.8s)
4. Tek-kelime durum rotasyonu (4s, WAAPI crossfade)
5. Lucide ikon seti (inline, ISC)
6. Segment haritası: 48 sabit bucket, node yeniden kurulmaz (opacity güncellenir)
7. A11y hızlı kazanımlar: aria-label, aria-live, focus-visible, reduced-motion tam kapsama
