#!/bin/sh
# Восстановление GameMarket из бэкапа (backup.sh). Запускается в сервисе backup:
#   docker compose -f infra/compose.prod.yaml --env-file infra/.env.production stop api web
#   docker compose -f infra/compose.prod.yaml --env-file infra/.env.production run --rm \
#     --entrypoint /ops/restore.sh backup /backups/db-20261110-0300.dump /backups/uploads-20261110-0300.tar.gz
#   docker compose -f infra/compose.prod.yaml --env-file infra/.env.production up -d
#
# База PGDATABASE очищается и заполняется из дампа. RESTORE_DB=<имя> —
# восстановить в отдельную базу рядом (проверка бэкапа, прод не трогается):
# она создаётся заново. Файлы (второй аргумент) — только при восстановлении
# в рабочую базу: том uploads заменяется архивом.
set -eu

DUMP="${1:?путь к db-*.dump}"
FILES="${2:-}"
TARGET="${RESTORE_DB:-$PGDATABASE}"

pg_restore --list "$DUMP" >/dev/null

if [ "$TARGET" != "$PGDATABASE" ]; then
  psql -v ON_ERROR_STOP=1 -d "$PGDATABASE" -c "DROP DATABASE IF EXISTS \"$TARGET\""
  psql -v ON_ERROR_STOP=1 -d "$PGDATABASE" -c "CREATE DATABASE \"$TARGET\""
fi

pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error -d "$TARGET" "$DUMP"

if [ -n "$FILES" ] && [ "$TARGET" = "$PGDATABASE" ]; then
  rm -rf /data/uploads/*
  tar -xzf "$FILES" -C /data
fi

echo "restore ok: $(basename "$DUMP") → $TARGET$( [ -n "$FILES" ] && [ "$TARGET" = "$PGDATABASE" ] && echo ", файлы из $(basename "$FILES")")"
