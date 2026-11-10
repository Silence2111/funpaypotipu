#!/usr/bin/env bash
# Запуск с пустым каталогом: на сервере выполняется только prisma/seed.ts —
# игры и разделы есть, лотов нет. Проверяет, что ни одна страница покупателя
# и продавца не выглядит сломанной и каждая ведёт к первому лоту:
#   bash infra/ops/empty-catalog.sh http://localhost
# API — там же, за Caddy; на стенде без Caddy адрес API — вторым аргументом.
# Только чтение; на базе с лотами отказывается — там другие тексты.
set -euo pipefail

URL="${1:?адрес сайта, например http://localhost}"
API="${2:-$URL}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
ok() { echo "✅ $1"; }
fail() { echo "❌ $1"; exit 1; }

total="$(curl -sf "$API/api/listings?limit=1" | sed -n 's/.*"total":\([0-9]*\).*/\1/p')"
[ "$total" = 0 ] || fail "в базе уже есть лоты ($total) — проверка только для пустого каталога"

# page <путь> — HTML страницы в $TMP/page.html; 200 и без экрана ошибки.
page() {
  code="$(curl -s -o "$TMP/page.html" -w '%{http_code}' "$URL$1")"
  [ "$code" = 200 ] || fail "$1 → $code"
  if grep -qF 'Что-то пошло не так' "$TMP/page.html"; then fail "$1 — экран ошибки"; fi
}
has() { grep -qF "$2" "$TMP/page.html" || fail "$1: нет «$2»"; }
hasnt() { if grep -qF "$2" "$TMP/page.html"; then fail "$1: лишнее «$2»"; fi; }

page /
has / 'Популярные'
has / 'Counter-Strike 2'
hasnt / 'Новые предложения'
ok "главная: игры и «Популярные» без пустых блоков"

page /igry
has /igry 'Counter-Strike 2'
ok "все игры"

page /igra/cs2/accounts
has раздел 'Предложений пока нет'
has раздел 'Выставить лот первым'
has раздел '/cabinet/new?game=cs2&amp;category=accounts'
# Ни фильтров, ни нулей у вкладок: на старте это читается как «здесь мёртво».
hasnt раздел 'class="count"'
hasnt раздел '0 предложений'
# Пустой раздел — не в индекс поиска, пока не появится первый лот.
has раздел 'noindex'
ok "пустой раздел: «Предложений пока нет» и «Выставить лот первым»"

page /igra/cs2
has игра 'Предложений пока нет'
ok "страница игры"

page /catalog
has каталог 'Предложений пока нет'
has каталог 'href="/prodavat"'
hasnt каталог 'уберите фильтры'
ok "каталог: «площадка только открылась», а не «уберите фильтры»"

page "/catalog?q=%D0%BA%D1%81"
has поиск 'href="/igra/cs2"'
hasnt поиск 'уберите фильтры'
ok "поиск «кс» ведёт в игру, хоть лотов и нет"

page /prodavat
has продавать 'Сколько вы получите'
has продавать 'Выставить'
ok "«Продавать»: калькулятор и кнопка"

curl -sf "$URL/sitemap.xml" -o "$TMP/sitemap.xml" || fail "sitemap.xml"
grep -qF '/igra/cs2<' "$TMP/sitemap.xml" || fail "в sitemap нет игр"
if grep -qF '/igra/cs2/accounts' "$TMP/sitemap.xml"; then fail "в sitemap пустой раздел"; fi
ok "sitemap: игры есть, пустых разделов нет"

echo "empty catalog ok: $URL"
