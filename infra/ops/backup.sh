#!/bin/sh
# Бэкап GameMarket: дамп базы (pg_dump -Fc) и архив файлов из тома uploads.
# Запускается сервисом backup из infra/compose.prod.yaml каждую ночь; руками:
#   docker compose -f infra/compose.prod.yaml --env-file infra/.env.production exec backup /ops/backup.sh
# Кладёт в /backups (BACKUP_DIR на сервере) пару файлов с одной меткой времени,
# старше BACKUP_KEEP_DAYS — удаляет. Пустой или битый дамп — ошибка, а не
# «успешный» файл в 0 байт.
set -eu

KEEP="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M)"
DIR=/backups
mkdir -p "$DIR"

DB="$DIR/db-$STAMP.dump"
pg_dump -Fc --no-owner --no-acl -f "$DB.part"
# Дамп читается обратно — иначе битый файл всплыл бы только при восстановлении.
pg_restore --list "$DB.part" >/dev/null
mv "$DB.part" "$DB"

FILES="$DIR/uploads-$STAMP.tar.gz"
tar -czf "$FILES.part" -C /data uploads
mv "$FILES.part" "$FILES"

find "$DIR" -maxdepth 1 \( -name 'db-*.dump' -o -name 'uploads-*.tar.gz' \) -mtime +"$KEEP" -delete

echo "backup ok: $(basename "$DB") $(du -h "$DB" | cut -f1), $(basename "$FILES") $(du -h "$FILES" | cut -f1)"
