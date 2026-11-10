#!/bin/sh
# Сторож: раз в минуту — готовность API (с базой), главная сайта и свежесть бэкапа.
# Упало или поднялось — строка в журнале и сообщение в Telegram, если заданы
# ALERT_BOT_TOKEN и ALERT_CHAT_ID (бот — любой свой, чат — куда слать).
# Сообщение — только при смене состояния, а не каждую минуту.
set -u

INTERVAL="${HEALTH_INTERVAL:-60}"
# Бэкап старше стольких часов — тревога: ночной раз в сутки плюс запас.
BACKUP_MAX_AGE_H="${BACKUP_MAX_AGE_H:-26}"
state_api=up
state_web=up
state_backup=up
started=$(date +%s)

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

# Свежесть бэкапа — по /backups/.last-ok, который пишет backup.sh. Пока
# бэкапа не было ни разу, первые сутки сторож ждёт: на свежем сервере его и
# не должно быть до первой ночи.
backup() {
  now=$(date +%s)
  if [ -f /backups/.last-ok ]; then
    age=$(( (now - $(date -r /backups/.last-ok +%s)) / 3600 ))
    if [ "$age" -lt "$BACKUP_MAX_AGE_H" ]; then fresh=up; else fresh=down; fi
  elif [ $(( (now - started) / 3600 )) -lt "$BACKUP_MAX_AGE_H" ]; then
    fresh=up; age=0
  else
    fresh=down; age='?'
  fi
  if [ "$fresh" != "$1" ]; then
    if [ "$fresh" = down ]; then alert "❌ бэкапа не было больше ${BACKUP_MAX_AGE_H} ч (последний — ${age} ч назад)"; else alert "✅ бэкап снова свежий"; fi
  fi
  echo "$fresh"
}

echo "$(date -u +%FT%TZ) healthwatch: каждые ${INTERVAL} с"
while true; do
  state_api=$(check API http://api:4000/api/health/ready "$state_api")
  state_web=$(check сайт http://web:3000/ "$state_web")
  state_backup=$(backup "$state_backup")
  sleep "$INTERVAL"
done
