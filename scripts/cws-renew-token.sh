#!/bin/bash
# cws-renew-token.sh — CWS refresh_token süresi dolunca (invalid_grant) yenile.
# Google, doğrulanmamış OAuth uygulamalarının refresh token'ını 7 günde bir iptal eder;
# bu script o döngüyü 1 dakikaya indirir.
#
# Kullanım: ./scripts/cws-renew-token.sh
#   1) Açılan URL'yi tarayıcında aç, Google hesabınla onayla
#   2) Adres çubuğundaki localhost adresinden ?code=... değerini kopyala, yapıştır
#   3) Yeni refresh_token her iki projenin .cws-secrets dosyasına yazılır
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SECRETS_MAIN="$HOME/01dev/yayincilik-ext/scripts/.cws-secrets"
for f in "$HERE/.cws-secrets" "$SECRETS_MAIN"; do
  if [ -f "$f" ]; then set -a; . "$f"; set +a; SRC="$f"; break; fi
done
: "${CWS_CLIENT_ID:?CWS_CLIENT_ID yok}"
: "${CWS_CLIENT_SECRET:?CWS_CLIENT_SECRET yok}"

AUTH_URL="https://accounts.google.com/o/oauth2/auth?client_id=${CWS_CLIENT_ID}&redirect_uri=http://localhost&response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&access_type=offline&prompt=consent"

echo "1) Bu adresi tarayıcıda aç ve onayla:"
echo
echo "$AUTH_URL"
echo
echo "2) Yönlendirilen 'localhost' adresindeki code= değerini yapıştır (sayfa açılmasa da adres çubuğunda görünür):"
read -r CODE
CODE="${CODE##*code=}"; CODE="${CODE%%&*}"
CODE="$(python3 -c "import urllib.parse,sys;print(urllib.parse.unquote(sys.argv[1]))" "$CODE")"

RESP=$(curl -s "https://oauth2.googleapis.com/token" \
  -d "client_id=${CWS_CLIENT_ID}" -d "client_secret=${CWS_CLIENT_SECRET}" \
  -d "code=${CODE}" -d "grant_type=authorization_code" -d "redirect_uri=http://localhost")

NEW=$(printf '%s' "$RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('refresh_token',''))")
if [ -z "$NEW" ]; then
  echo "refresh_token alınamadı:"; printf '%s\n' "$RESP" | head -c 400; exit 1
fi

python3 - "$SRC" "$NEW" <<'PY'
import re, sys
path, token = sys.argv[1], sys.argv[2]
src = open(path).read()
if 'CWS_REFRESH_TOKEN' in src:
    src = re.sub(r'CWS_REFRESH_TOKEN=.*', f'CWS_REFRESH_TOKEN={token}', src)
else:
    src = src.rstrip() + f'\nCWS_REFRESH_TOKEN={token}\n'
open(path, 'w').write(src)
print('yazıldı:', path)
PY
echo "✓ Yenilendi. Şimdi: ./scripts/cws-publish.sh"
