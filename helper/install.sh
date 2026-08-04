#!/usr/bin/env bash
# Ruu Helper kurulumu — macOS ve Linux.
#
# Ne yapar: derlenmiş ikiliyi kullanıcı dizinine kopyalar ve Chrome'un
# native-messaging manifest'ini yazar. Sistem geneline HİÇBİR ŞEY yazmaz,
# servis kaydetmez, yönetici hakkı istemez.
#
# Kaldırmak için: ./install.sh --uninstall
set -euo pipefail

EXT_ID="${RUU_EXT_ID:?RUU_EXT_ID gerekli — chrome://extensions sayfasındaki kimlik}"
HOST_NAME="com.ruu.downloader.helper"
BIN_DIR="$HOME/.local/bin"
BIN="$BIN_DIR/ruu-helper"

case "$(uname -s)" in
  Darwin) MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" ;;
  Linux)  MANIFEST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts" ;;
  *) echo "desteklenmeyen sistem: $(uname -s)"; exit 1 ;;
esac

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$BIN" "$MANIFEST_DIR/$HOST_NAME.json"
  echo "kaldırıldı: $BIN ve manifest. Başka hiçbir iz bırakılmamıştı."
  exit 0
fi

command -v go >/dev/null || { echo "go bulunamadı — https://go.dev/dl"; exit 1; }
mkdir -p "$BIN_DIR" "$MANIFEST_DIR"

echo "→ derleniyor (yeniden üretilebilir bayraklarla)"
cd "$(dirname "$0")"
CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -buildid=" -o "$BIN" .
chmod +x "$BIN"

echo "→ manifest yazılıyor: $MANIFEST_DIR/$HOST_NAME.json"
cat > "$MANIFEST_DIR/$HOST_NAME.json" <<JSON
{
  "name": "$HOST_NAME",
  "description": "Ruu Downloader helper",
  "path": "$BIN",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
JSON

echo
echo "kuruldu."
echo "  ikili   : $BIN"
echo "  sağlama : $(shasum -a 256 "$BIN" | cut -d' ' -f1)"
echo "  erişim  : yalnızca chrome-extension://$EXT_ID"
echo
echo "Bu sağlamayı CHECKSUMS.txt ile karşılaştırabilirsin."
