#!/usr/bin/env bash
# Проверка боевого стека снаружи — через Caddy, как ходит браузер:
#   bash infra/ops/smoke.sh https://домен
# API с базой, главная собрана на сервере с каталогом, регистрация, фото лота
# загружается и открывается по ссылке (том файлов и адрес файлов верны).
# Оставляет в базе пользователя smoke_<время> и фото — для проверки бэкапа.
set -euo pipefail

URL="${1:?адрес сайта, например https://gamemarket.ru}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
ok() { echo "✅ $1"; }
fail() { echo "❌ $1"; exit 1; }

health="$(curl -sf "$URL/api/health")" || fail "API не отвечает: $URL/api/health"
echo "$health" | grep -q '"db":"up"' || fail "API без базы: $health"
curl -sf "$URL/api/health/ready" >/dev/null || fail "API не готов: $URL/api/health/ready"
ok "API и база"

curl -sf "$URL/" -o "$TMP/home.html" || fail "главная не открывается"
grep -q 'GameMarket' "$TMP/home.html" || fail "главная без названия"
# Каталог собран на сервере: игры из сида — прямо в HTML, а не после загрузки в браузере.
grep -q 'Counter-Strike' "$TMP/home.html" || fail "в HTML главной нет игр каталога"
ok "главная с каталогом — с сервера"

name="smoke_$(date +%s)"
reg="$(curl -sf -X POST "$URL/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$name@smoke.local\",\"password\":\"smoke-password-123\",\"username\":\"$name\"}")" \
  || fail "регистрация не прошла"
token="$(echo "$reg" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')"
[ -n "$token" ] || fail "регистрация без токена: $reg"
ok "регистрация $name"

echo '89504e470d0a1a0a0000000d4948445200000001' | xxd -r -p > "$TMP/shot.png"
up="$(curl -sf -X POST "$URL/api/listings/uploads" -H "Authorization: Bearer $token" \
  -F "file=@$TMP/shot.png;type=image/png")" || fail "фото лота не загрузилось"
key="$(echo "$up" | sed -n 's/.*"key":"\([^"]*\)".*/\1/p')"
[ -n "$key" ] || fail "загрузка без ключа: $up"
type="$(curl -sf -o "$TMP/got.png" -w '%{content_type}' "$URL/api/assets?key=$(printf %s "$key" | sed 's|/|%2F|g')")" \
  || fail "фото не открывается по ссылке"
[ "$type" = image/png ] || fail "фото отдаётся как $type"
cmp -s "$TMP/shot.png" "$TMP/got.png" || fail "фото отдаётся не тем файлом"
ok "фото лота: загрузка и чтение ($key)"

# Превью ссылки на лот рисуется на сервере шрифтом из node_modules: без него
# ссылки в Telegram и VK — без картинки. Несуществующий лот — та же картинка.
og="$(curl -sf -o "$TMP/og.png" -w '%{content_type}' "$URL/lot/00000000-0000-4000-8000-000000000000/opengraph-image")" \
  || fail "превью ссылки на лот не рисуется"
[ "$og" = image/png ] && [ "$(wc -c < "$TMP/og.png")" -gt 5000 ] || fail "превью ссылки на лот: $og"
ok "превью ссылки на лот"

echo "$key" > "${SMOKE_KEY_FILE:-/dev/null}"
echo "smoke ok: $URL"
