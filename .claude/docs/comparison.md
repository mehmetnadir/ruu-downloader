# Ruu Downloader — Bağımsız Karşılaştırma Raporu

> Amaç: pazarlama değil, **dürüst durum tespiti**. Her iddia ya üründe ölçüldü ya da
> kaynak linkiyle verildi. Ruu'nun eksikleri de aynı tabloda.
> Hazırlık: 2026-08-02 · Rakip verileri araştırma ajanının bulgularıyla dolduruluyor.

## Ruu'nun ölçülen gerçekleri (bu depodan, komutla doğrulanabilir)

| Ölçüm | Değer | Nasıl doğrulanır |
|---|---|---|
| Birim testi | 72 geçiyor | `npm test` |
| E2E senaryosu | 10/10 (headful + headless) | `./test/e2e/run.sh` |
| Gerçek servis saha testi | 5 servis (Lifebox, WeTransfer, Gofile, Catbox, Filebin) | `test/field/` |
| Tanınan paylaşım servisi | 28 | `src/content/services.ts` |
| Dil | 11 (RTL dahil) | `public/_locales/` |
| Manifest izni | 11 + `*://*/*` | `public/manifest.json` |
| Paket boyutu | 60 KB | `out/*.zip` |
| Çalışma zamanı bağımlılığı | 0 | `package.json` |
| Kaynak satırı | ~2.750 (TypeScript) | `find src -name '*.ts' \| xargs wc -l` |
| Uzak telemetri | Yok | Kodda tek bir dış istek yok (indirilen URL hariç) |
| Masaüstü uygulama gereksinimi | Yok | Saf MV3 |

## Ruu'nun bilinen eksikleri (dürüstlük bölümü)

1. **Kullanıcı tabanı yok** — henüz yayınlanmadı; olgun rakiplerin milyonlarca
   kullanıcısı ve yıllarca saha testi var. Bizde 5 servis gerçek linkle
   doğrulandı, 20 servis yalnızca desen düzeyinde.
2. **Video/stream indirme yok** — bilinçli kapsam kararı, ama IDM/FDM
   kullanıcılarının önemli bir bölümü tam olarak bunu istiyor.
3. **Kuyruk & zamanlama UI yok** — veri modeli hazır, arayüz henüz yok.
4. **Torrent/magnet yok** — kapsam dışı.
5. **P2P ve telefon aktarımı yolda** — röle canlı, istemciler yazılmadı.
6. **Bant genişliği sınırlama yok** — planlı.
7. **Tarayıcı desteği yalnızca Chromium** — Firefox portu yapılmadı.

## Rakip tablosu

_(araştırma ajanının raporuyla doldurulacak)_

## Pazar boşluğu tezi

_(araştırma ajanının bulgularıyla netleşecek)_
