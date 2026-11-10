#!/usr/bin/env bash
# Демо-стенд GameMarket одной командой: база → витрина-пример → API :4077 → сайт :3077.
#
# Нужно заранее: Node 22, pnpm 9, PostgreSQL с базой из DATABASE_URL в .env
# (Redis, S3, почта — не нужны: без них API работает, фото лотов не грузятся).
#
#   scripts/pokaz.sh          поднять стенд (Ctrl+C — остановить)
#   scripts/pokaz.sh sbros    перед показом: снять лоты прошлых показов, освежить витрину
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "Нет .env: cp .env.example .env и заполните DATABASE_URL"; exit 1; }
set -a; source ./.env; set +a
# В шелле владельца стоит NODE_ENV=production — с ним next dev отдаёт 500.
export NODE_ENV=development PAYMENT_PROVIDER="${PAYMENT_PROVIDER:-mock}"
export API_PORT=4077 API_URL=http://localhost:4077 PUBLIC_ASSET_BASE=http://localhost:4077
export NEXT_PUBLIC_API_URL=http://localhost:4077 NEXT_PUBLIC_SITE_URL=http://localhost:3077

[ -d node_modules ] || pnpm install
pnpm --filter @gamemarket/db generate >/dev/null
pnpm --filter @gamemarket/db migrate:deploy
pnpm --filter @gamemarket/shared build >/dev/null
pnpm --filter @gamemarket/db seed
if [ "${1:-}" = "sbros" ]; then
  pnpm --filter @gamemarket/db demo:reset
else
  pnpm --filter @gamemarket/db seed:demo
fi

trap 'kill 0' EXIT
(cd apps/api && pnpm dev) &
(cd apps/web && npx next dev -p 3077) &
sleep 15
echo
echo "Стенд: http://localhost:3077   (API: http://localhost:4077/api)"
echo "Оплата демонстрационная: PAYMENT_PROVIDER=mock, деньги не списываются."
wait
