# GameMarket — маркетплейс цифровых игровых товаров

P2P-маркетплейс цифровых игровых товаров с эскроу, встроенным чатом, рейтингами и
системой споров — по модели **FunPay / Playerok**, с расширением в сегмент
**пополнений и авто-выдачи** (Kupikod / GGSel).

> Кодовое имя проекта: `fp-pl` (FunPay × Playerok). Рабочее имя в коде: `gamemarket`.

## Что это

Площадка-посредник между продавцами и покупателями цифровых товаров:

- **Игровые ценности** — аккаунты, внутриигровая валюта, предметы.
- **Услуги** — буст, прокачка, сопровождение.
- **Ключи и цифровые товары** — авто-выдача из склада ключей.
- **Пополнения и донат** — Steam, подписки, внутриигровые покупки (через провайдеров).

Деньги покупателя удерживаются на эскроу-счёте площадки до подтверждения сделки;
площадка зарабатывает на комиссии. Подробнее о бизнес-модели и рынке — в
[docs/00-vision-and-scope.md](docs/00-vision-and-scope.md).

## Документация (архитектура)

| # | Документ | О чём |
|---|----------|-------|
| 00 | [Видение и scope](docs/00-vision-and-scope.md) | Сегменты рынка, ниша, бизнес-модель, границы MVP |
| 01 | [Системная архитектура](docs/01-architecture.md) | Стек, компоненты, потоки данных, диаграммы |
| 02 | [Доменная модель и ER](docs/02-domain-model.md) | Сущности, связи, схема БД |
| 03 | [Эскроу и бухгалтерия](docs/03-escrow-and-ledger.md) | Машина состояний сделки, двойная запись (ledger) |
| 04 | [Платежи и выплаты](docs/04-payments-and-payouts.md) | Провайдеры, вебхуки, идемпотентность, реконсиляция |
| 05 | [Realtime-чат](docs/05-realtime-chat.md) | WebSocket, хранение, маскирование контактов |
| 06 | [Trust & Safety](docs/06-trust-safety-antifraud.md) | Антифрод, антискам, споры, модерация |
| 07 | [Поиск и SEO](docs/07-search-and-seo.md) | FTS → поисковый движок, SSR, структурированные данные |
| 08 | [Инфраструктура и DevOps](docs/08-infrastructure-devops.md) | Docker, CI/CD, observability, окружения |
| 09 | [Безопасность](docs/09-security.md) | Auth, RBAC, 2FA, защита данных, secrets |
| 10 | [Структура монорепо](docs/10-repo-structure.md) | Раскладка apps/packages/infra |
| 11 | [Дорожная карта](docs/11-roadmap.md) | Фазы поставки от фундамента до прод |

## Стек (кратко)

- **Монорепо:** pnpm workspaces + Turborepo
- **Backend:** NestJS (TypeScript), модульная архитектура
- **Frontend:** Next.js (App Router, RSC) — SSR/SEO
- **БД:** PostgreSQL + Prisma
- **Кэш/очереди:** Redis + BullMQ
- **Realtime:** WebSocket (Socket.IO + Redis adapter)
- **Поиск:** Postgres FTS / pg_trgm → Meilisearch/OpenSearch
- **Хранилище:** S3-совместимое (MinIO локально)
- **Инфра:** Docker Compose (локально), GitHub Actions (CI)

Полное обоснование выбора — [docs/01-architecture.md](docs/01-architecture.md).

## Быстрый старт

Требуется Node.js ≥ 22 и pnpm ≥ 9 (`corepack enable pnpm`). Docker — для локальной инфры.

```bash
pnpm install                       # зависимости
cp .env.example .env               # конфигурация
docker compose -f infra/compose.yaml up -d   # postgres, redis, minio, meili, mailhog
pnpm db:generate                   # сгенерировать Prisma-клиент
pnpm db:migrate                    # применить миграции (создаются при первом запуске)
pnpm db:seed                       # демо-данные (роли, игры, комиссия)
pnpm dev                           # api :4000, web :3000, worker
```

Проверка без БД: `GET http://localhost:4000/api/health` → `{ status, db, ts }`.

## Структура

```
apps/      api (NestJS) · web (Next.js) · worker (BullMQ)
packages/  db (Prisma) · shared (типы/контракты/деньги) · config (tsconfig)
infra/     compose.yaml (postgres, redis, minio, meilisearch, mailhog)
docs/      архитектура (00..11)
```

## Статус

🟢 **Фаза 0 — Фундамент (готов каркас).** Заложена плановая архитектура (docs/00..11)
и рабочий каркас монорепо: полная Prisma-схема, NestJS API (health + auth-скелет),
Next.js (SSR), BullMQ-воркер, инфраструктура и CI. Все пакеты проходят typecheck.
Дальше — наполнение фаз 1+ (см. [дорожную карту](docs/11-roadmap.md)).
