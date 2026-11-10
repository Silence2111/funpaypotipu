#!/bin/sh
# Бэкап GameMarket: дамп базы (pg_dump -Fc) и архив файлов из тома uploads.
# Запускается сервисом backup из infra/compose.prod.yaml каждую ночь; руками:
#   docker compose -f infra/compose.prod.yaml --env-file infra/.env.production exec backup /ops/backup.sh
# Кладёт в /backups (BACKUP_DIR на сервере) пару файлов с одной меткой времени,
# старше BACKUP_KEEP_DAYS — удаляет. Пустой или битый дамп — ошибка, а не
# «успешный» файл в 0 байт.
#
# Копия вне сервера: задан BACKUP_S3_BUCKET — та же пара уходит в любое
# S3-совместимое хранилище (Яндекс Object Storage, Timeweb, Selectel…) и
# сверяется по размеру; там хранится BACKUP_S3_KEEP_DAYS. Сервер умирает
# вместе со своими бэкапами — копия должна жить отдельно.
#
# Удачный бэкап пишет время в /backups/.last-ok: сторож (healthwatch.sh)
# сообщает, если бэкапа не было больше суток.
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

offsite="нет"
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  # rclone без файла настроек: всё — из окружения, секреты не попадают в командную строку.
  export RCLONE_CONFIG_OFFSITE_TYPE=s3
  export RCLONE_CONFIG_OFFSITE_PROVIDER=Other
  export RCLONE_CONFIG_OFFSITE_ENDPOINT="${BACKUP_S3_ENDPOINT:?задайте BACKUP_S3_ENDPOINT}"
  export RCLONE_CONFIG_OFFSITE_REGION="${BACKUP_S3_REGION:-us-east-1}"
  export RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY:?задайте BACKUP_S3_ACCESS_KEY}"
  export RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_KEY:?задайте BACKUP_S3_SECRET_KEY}"
  export RCLONE_CONFIG_OFFSITE_NO_CHECK_BUCKET=true
  REMOTE="offsite:$BACKUP_S3_BUCKET/${BACKUP_S3_PREFIX:-gamemarket}"
  for f in "$DB" "$FILES"; do
    rclone copyto "$f" "$REMOTE/$(basename "$f")"
    # Сверка по размеру: оборванная загрузка не считается копией.
    local_size=$(stat -c %s "$f")
    remote_size=$(rclone size --json "$REMOTE/$(basename "$f")" | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')
    [ "$local_size" = "$remote_size" ] || { echo "копия $(basename "$f") вне сервера не сошлась: $local_size ≠ $remote_size"; exit 1; }
  done
  rclone delete --min-age "${BACKUP_S3_KEEP_DAYS:-30}d" "$REMOTE" || true
  offsite="$REMOTE"
fi

date -u +%FT%TZ > "$DIR/.last-ok"
echo "backup ok: $(basename "$DB") $(du -h "$DB" | cut -f1), $(basename "$FILES") $(du -h "$FILES" | cut -f1); вне сервера: $offsite"
