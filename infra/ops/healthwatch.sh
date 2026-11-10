#!/bin/sh
# Сторож: раз в минуту — готовность API (с базой) и главная сайта.
# Упало или поднялось — строка в журнале и сообщение в Telegram, если заданы
# ALERT_BOT_TOKEN и ALERT_CHAT_ID (бот — любой свой, чат — куда слать).
# Сообщение — только при смене состояния, а не каждую минуту.
set -u

INTERVAL="${HEALTH_INTERVAL:-60}"
state_api=up
state_web=up

alert() {
  # В stderr: stdout check() — это состояние, его забирает $(…).
  echo "$(date -u +%FT%TZ) $1" >&2
  [ -n "${ALERT_BOT_TOKEN:-}" ] && [ -n "${ALERT_CHAT_ID:-}" ] || return 0
  curl -s -m 10 -o /dev/null "https://api.telegram.org/bot${ALERT_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${ALERT_CHAT_ID}" \
    --data-urlencode "text=GameMarket ${PUBLIC_URL:-}: $1" || echo "$(date -u +%FT%TZ) Telegram не ответил" >&2
}

check() {
  # $1 — имя, $2 — адрес, $3 — прошлое состояние; печатает новое.
  if curl -sf -m 10 -o /dev/null "$2"; then now=up; else now=down; fi
  if [ "$now" != "$3" ]; then
    if [ "$now" = down ]; then alert "❌ $1 не отвечает ($2)"; else alert "✅ $1 снова работает"; fi
  fi
  echo "$now"
}

echo "$(date -u +%FT%TZ) healthwatch: каждые ${INTERVAL} с"
while true; do
  state_api=$(check API http://api:4000/api/health/ready "$state_api")
  state_web=$(check сайт http://web:3000/ "$state_web")
  sleep "$INTERVAL"
done
