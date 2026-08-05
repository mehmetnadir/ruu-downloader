#!/usr/bin/env bash
#
# Ruu Helper kurulumu — macOS ve Linux.
#
# Kullanım (eklentinin ayarlar ekranı bu satırı kimliğinle birlikte verir):
#   curl -fsSL https://raw.githubusercontent.com/mehmetnadir/ruu-downloader/main/helper/install.sh | bash -s -- <EKLENTI_ID>
#
# Kaldırmak için:
#   ~/.local/bin/ruu-helper-uninstall
#
# Ne yapar: hazır ikiliyi indirir, SHA-256'sını doğrular, ev dizinine koyar ve
# Chrome'un native-messaging manifest'ini yazar.
# Ne YAPMAZ: yönetici hakkı istemez, sistem geneline yazmaz, servis kaydetmez,
# otomatik güncelleme kurmaz, hiçbir yere veri göndermez.
set -euo pipefail

REPO="mehmetnadir/ruu-downloader"
HOST_NAME="com.ruu.downloader.helper"
BIN_DIR="$HOME/.local/bin"
BIN="$BIN_DIR/ruu-helper"

EXT_ID="${1:-${RUU_EXT_ID:-}}"
if [ -z "$EXT_ID" ]; then
  echo "Eklenti kimliği gerekli."
  echo "Ruu ayarlarında 'Yardımcı uygulama' satırındaki komutu kopyala — kimliğin içinde hazır."
  exit 1
fi
case "$EXT_ID" in
  [a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p][a-p]* ) ;;
  *) echo "Bu bir Chrome eklenti kimliğine benzemiyor: $EXT_ID"; exit 1 ;;
esac

case "$(uname -s)" in
  Darwin) OS=darwin; MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" ;;
  Linux)  OS=linux;  MANIFEST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts" ;;
  *) echo "Desteklenmeyen sistem: $(uname -s). Windows için install.ps1 kullan."; exit 1 ;;
esac
case "$(uname -m)" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|amd64)  ARCH=amd64 ;;
  *) echo "Desteklenmeyen mimari: $(uname -m)"; exit 1 ;;
esac

mkdir -p "$BIN_DIR" "$MANIFEST_DIR"
ASSET="ruu-helper-${OS}-${ARCH}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if command -v go >/dev/null && [ -f "$(dirname "$0")/main.go" ]; then
  # Depo yanındaysan kaynaktan derle — indirmeye gerek yok, en doğrulanabilir yol.
  echo "→ kaynaktan derleniyor"
  # Not: kaynaktan derleme, Go araç zincirinin KENDİ önbellek/telemetri
  # dosyalarını günceller (her Go kullanımında olduğu gibi; env ile
  # yönlendirilemiyor, denedik). Bunlar Go'ya aittir, Ruu'ya değil —
  # kaldırıcımız yalnızca Ruu'nun kurduklarını söker.
  (cd "$(dirname "$0")" && CGO_ENABLED=0 \
     go build -trimpath -ldflags "-s -w -buildid=" -o "$TMP/$ASSET" .)
else
  echo "→ hazır ikili indiriliyor ($OS/$ARCH)"
  BASE="https://github.com/$REPO/releases/latest/download"
  curl -fsSL "$BASE/$ASSET" -o "$TMP/$ASSET"
  curl -fsSL "$BASE/CHECKSUMS.txt" -o "$TMP/CHECKSUMS.txt"

  echo "→ sağlama doğrulanıyor"
  WANT="$(grep " $ASSET\$" "$TMP/CHECKSUMS.txt" | awk '{print $1}')"
  if command -v shasum >/dev/null; then GOT="$(shasum -a 256 "$TMP/$ASSET" | awk '{print $1}')"
  else GOT="$(sha256sum "$TMP/$ASSET" | awk '{print $1}')"; fi
  if [ -z "$WANT" ] || [ "$WANT" != "$GOT" ]; then
    echo "SAĞLAMA UYUŞMADI — kurulum durduruldu."
    echo "  beklenen: ${WANT:-<yok>}"
    echo "  gelen   : $GOT"
    exit 1
  fi
fi

install -m 0755 "$TMP/$ASSET" "$BIN"

cat > "$MANIFEST_DIR/$HOST_NAME.json" <<JSON
{
  "name": "$HOST_NAME",
  "description": "Ruu Downloader helper",
  "path": "$BIN",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
JSON

# Kaldırma tek komut olsun — geri dönüşü zor kurulum güven kırar.
cat > "$BIN_DIR/ruu-helper-uninstall" <<UNINST
#!/bin/sh
rm -f "$BIN" "$MANIFEST_DIR/$HOST_NAME.json" "$BIN_DIR/ruu-helper-uninstall"
echo "Ruu Helper kaldırıldı — Ruu'nun kurduğu her şey söküldü."
UNINST
chmod +x "$BIN_DIR/ruu-helper-uninstall"

echo
echo "Kuruldu."
echo "  ikili     : $BIN"
echo "  sağlama   : $("${BIN}" -version 2>/dev/null || true)"
echo "  erişim    : yalnızca chrome-extension://$EXT_ID"
echo "  kaldırma  : ruu-helper-uninstall"
echo
echo "Şimdi Chrome'da Ruu panelini kapatıp aç, 'Yardımcı uygulama' kendiliğinden bağlanacak."
