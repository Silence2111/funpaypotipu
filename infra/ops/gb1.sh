#!/usr/bin/env bash
# Выкат Lutli на gb1 (Франкфурт) — с мака владельца, из закоммиченного main (19.11.2026).
#   bash infra/ops/gb1.sh            — main с GitHub → /opt/lutli → сборка образов на gb1 → запуск → проверка
#   bash infra/ops/gb1.sh --no-build — только перезапуск (поменяли infra/.env.gb1 на сервере)
# Схема и почему так — docs/12-deploy.md, раздел «Lutli на gb1». Секреты — infra/.env.gb1 на сервере
# (копия — ~/.claude/secrets/lutli-prod.env на маке); сюда не попадают.
set -euo pipefail
cd "$(dirname "$0")/../.."
HOST="${LUTLI_HOST:-a3gb-l}"
C="docker compose -f infra/compose.gb1.yaml --env-file infra/.env.gb1"
if [ "${1:-}" != "--no-build" ]; then
  git fetch -q origin
  REV=$(git rev-parse --short origin/main)
  echo "── код origin/main $REV → $HOST:/opt/lutli"
  # .env.gb1 и бэкапы на сервере не трогаем: архив их не содержит
  git archive --format=tar.gz origin/main | ssh "$HOST" 'tar xzf - -C /opt/lutli'
  echo "── сборка образов (по одному: на gb1 рядом живёт Мерпи)"
  ssh "$HOST" "cd /opt/lutli && nice -n 10 $C build migrate && nice -n 10 $C build web"
fi
echo "── запуск: migrate применит миграции до старта API"
ssh "$HOST" "cd /opt/lutli && $C up -d --no-build && $C ps --format '{{.Service}} {{.State}} {{.Health}}'"
echo "── проверка снаружи (только чтение)"
ssh "$HOST" "cd /opt/lutli && SMOKE_READONLY=1 bash infra/ops/smoke.sh https://lutli.ru"
