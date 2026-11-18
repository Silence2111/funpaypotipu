#!/usr/bin/env bash
# Оферта, политика, согласия и форма обращения lutli.ru — из общей системы юрдокументов.
#
#   bash infra/ops/yur.sh            — собрать из ~/Projects/_система/юр и выложить на сервер
#   YUR_HOST=root@1.2.3.4 bash infra/ops/yur.sh
#   bash infra/ops/yur.sh --local    — положить на стенд (apps/web/public/yur), без сервера
#
# Тексты правятся там, в проекты/lutli.txt, а не здесь: оператор, статус и правила у всех
# сайтов одни (~/Projects/CLAUDE.md, «Юридические документы сайтов»). Собирается закоммиченное
# (HEAD), а не рабочая папка: там работают параллельные сессии. Файлы ложатся в
# /opt/gamemarket/infra/yur, Caddy (infra/Caddyfile, матчер @yur) отдаёт их раньше сайта;
# отправку формы /obrashchenie/otpravit принимает API (modules/contact-requests).
# Повторный запуск безопасен. Без YUR_HOST — только собрать и показать, что выложится.
set -euo pipefail

HOST="${YUR_HOST:-}"
DOMAIN="${YUR_DOMAIN:-lutli.ru}"
DIR="${YUR_DIR:-/opt/gamemarket/infra/yur}"
# _система/юр ищем вверх от репо: ~/Projects/<проект> и ~/Projects/_wt/<копия> — обе дойдут до ~/Projects
YUR="${YUR_SRC:-}"
if [ -z "$YUR" ]; then
  d="$(cd "$(dirname "$0")/../.." && pwd)"
  while [ "$d" != "/" ] && [ ! -d "$d/_система/юр" ]; do d="$(dirname "$d")"; done
  YUR="$d/_система/юр"
fi
[ -f "$YUR/проекты/lutli.txt" ] || { echo "нет $YUR/проекты/lutli.txt" >&2; exit 1; }

SRC=$(mktemp -d); PACK=$(mktemp -d); trap 'rm -rf "$SRC" "$PACK"' EXIT
TOP=$(git -C "$YUR" rev-parse --show-toplevel)
REL=$(git -C "$YUR" rev-parse --show-prefix)
git -C "$TOP" archive HEAD "$REL" | tar -x -C "$SRC"
echo "документы из HEAD: $(git -C "$YUR" log -1 --format='%h %s' -- .)"
python3 "$SRC/$REL/собрать.py"
DOCS="$SRC/$REL/выход/$DOMAIN"

# Раскладка по адресам: /privacy → privacy/index.html, /obrashchenie/soglasie → obrashchenie/soglasie/index.html
for d in privacy oferta soglasie soglasie-rasprostranenie; do
  mkdir -p "$PACK/$d"; cp "$DOCS/$d.html" "$PACK/$d/index.html"
done
mkdir -p "$PACK/obrashchenie/soglasie"
cp "$DOCS/obrashchenie.html" "$PACK/obrashchenie/index.html"
cp "$DOCS/obrashchenie-soglasie.html" "$PACK/obrashchenie/soglasie/index.html"
(cd "$PACK" && find . -name '*.html' | sort)

# --local: на стенд — в apps/web/public/yur, сайт отдаёт их по тем же адресам (next.config.mjs, перезапуск dev)
if [ "${1:-}" = "--local" ]; then
  WEB="$(cd "$(dirname "$0")/../.." && pwd)/apps/web/public/yur"
  rm -rf "$WEB"; mkdir -p "$WEB"; cp -R "$PACK/." "$WEB/"
  echo "положено в $WEB"; exit 0
fi
if [ -z "$HOST" ]; then
  echo "YUR_HOST не задан — собрано, на сервер не выкладывал"; exit 0
fi
COPYFILE_DISABLE=1 tar --no-xattrs -C "$PACK" -czf - . | ssh -o ConnectTimeout=25 "$HOST" "set -e
  D=$DIR; mkdir -p \$D.new; tar --no-same-owner -xzf - -C \$D.new; chmod -R a+rX \$D.new
  rm -rf \$D.old; [ -d \$D ] && mv \$D \$D.old; mv \$D.new \$D; rm -rf \$D.old"

for p in /privacy /oferta /soglasie /soglasie-rasprostranenie /obrashchenie/ /obrashchenie/soglasie; do
  printf '%-28s %s\n' "$p" "$(curl -s -m 15 -o /dev/null -w '%{http_code}' "https://$DOMAIN$p")"
done
