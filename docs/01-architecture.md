# 01 — Системная архитектура и стек

## 1. Принципы

1. **Modular monolith → микросервисы по необходимости.** Старт — модульный монолит
   на NestJS (чёткие границы модулей), чтобы не платить цену распределённой системы
   до того, как появится нагрузка. Денежное ядро выносится в сервис первым, когда понадобится.
2. **Деньги — строго и аудируемо.** Двойная запись, идемпотентность, неизменяемый журнал.
3. **SSR-first для публичного фронта.** Органика — главный канал (см. [07](07-search-and-seo.md)).
4. **Асинхронность через очереди.** Выдача, уведомления, вебхуки, антифрод — в воркерах.
5. **Типобезопасность сквозная.** Общие типы/контракты в `packages/shared`, валидация Zod.
6. **Конфигурация — данные, не код.** Комиссии, лимиты, категории, атрибуты — в БД.

## 2. Выбор стека и обоснование

| Слой | Выбор | Почему именно так |
|------|-------|-------------------|
| Язык | **TypeScript** (везде) | Один язык фронт+бэк, общие типы, большой найм |
| Монорепо | **pnpm workspaces + Turborepo** | Кэш сборок, общие пакеты, атомарные изменения |
| Backend | **NestJS** | Модульность, DI, гварды/интерсепторы, WS, очереди, зрелость |
| Frontend | **Next.js (App Router, RSC)** | SSR/ISR для SEO, серверные компоненты, маршрутизация |
| ORM | **Prisma** | Типобезопасные миграции и клиент; raw SQL для ledger-критичных мест |
| БД | **PostgreSQL** | Транзакции, JSONB (атрибуты), FTS, надёжность для денег |
| Кэш/локи/pub-sub | **Redis** | Кэш, rate-limit, распределённые локи, адаптер WS |
| Очереди | **BullMQ** (на Redis) | Ретраи, отложенные джобы (авто-подтверждение), приоритеты |
| Realtime | **Socket.IO + Redis adapter** | Чат, нотификации, статусы «онлайн/печатает» |
| Поиск | **PG FTS/pg_trgm → Meilisearch/OpenSearch** | Старт дёшево, миграция при росте фасетов |
| Объекты | **S3-совместимое (MinIO локально)** | Картинки, вложения чата, файлы ключей |
| Auth | **JWT (access+refresh) в httpOnly cookie, TOTP 2FA, OAuth** | Стандарт, ротация токенов, без vendor-lock |
| Платежи | **Абстракция `PaymentProvider`** | RU-рынок «серый» → нужна сменяемость провайдеров |
| API-контракт | **REST + OpenAPI/Swagger** + WS-события | Публичность, мобилки, генерация клиентов |
| Валидация | **Zod** (общие схемы DTO) | Один источник правды фронт/бэк |
| Логи/трейсы/метрики | **pino + OpenTelemetry + Prometheus/Grafana + Sentry** | Наблюдаемость денег и инцидентов |
| Контейнеризация | **Docker + Compose (локально), K8s-ready** | Воспроизводимость, путь в прод |

> ⚖️ **Альтернативы, которые сознательно отклонены сейчас:** Drizzle вместо Prisma
> (рассмотрим, если упрёмся в перф ORM), tRPC вместо REST (теряем публичный контракт),
> GraphQL (избыточно для старта), Kafka (BullMQ достаточно до больших объёмов).

## 3. Компоненты системы (C4: контейнеры)

```mermaid
flowchart TB
    subgraph Client["Клиенты"]
        Web["Браузер (SSR Next.js)"]
        TG["Telegram Mini App / бот (позже)"]
        Mobile["Мобилка (позже)"]
    end

    subgraph Edge["Edge"]
        CDN["CDN / статика"]
        LB["Reverse proxy / LB (nginx)"]
    end

    subgraph Apps["Приложения"]
        NextApp["apps/web — Next.js\n(SSR, публичные страницы, кабинет)"]
        Api["apps/api — NestJS\n(REST + WebSocket Gateway)"]
        Worker["apps/worker — NestJS\n(BullMQ processors)"]
    end

    subgraph Data["Данные и инфраструктура"]
        PG[("PostgreSQL\n(+ read replica)")]
        Redis[("Redis\nкэш / очереди / pub-sub")]
        S3[("S3 / MinIO\nфайлы")]
        Search[("Search engine\nMeilisearch/OpenSearch")]
    end

    subgraph External["Внешние сервисы"]
        Pay["Платёжные провайдеры\n(вебхуки)"]
        TopUp["Провайдеры пополнений\n(Steam/донат)"]
        Mail["Email / SMS / Push"]
        OAuth["OAuth (Google/VK/Telegram)"]
    end

    Web --> CDN
    Web --> LB
    TG --> LB
    Mobile --> LB
    LB --> NextApp
    LB --> Api
    NextApp -->|REST| Api
    Api --> PG
    Api --> Redis
    Api --> S3
    Api --> Search
    Api -. enqueue .-> Redis
    Worker --> Redis
    Worker --> PG
    Worker --> Search
    Worker --> Mail
    Worker --> TopUp
    Pay -->|webhook| Api
    Api --> OAuth
```

## 4. Модули backend (границы домена)

NestJS-модули — будущие границы для выделения в сервисы:

```
api/src/modules/
  auth/            — регистрация, логин, refresh, 2FA, OAuth, сессии
  users/           — профили, рейтинги, настройки, KYC
  catalog/         — игры, категории, атрибуты, лоты (listings)
  inventory/       — склад ключей/кодов для авто-выдачи
  search/          — индексация и запросы поиска
  orders/          — сделки, машина состояний, выдача (fulfillment)
  ledger/          — двойная бухгалтерия, счета, проводки (ядро денег)
  payments/        — депозиты, вебхуки, провайдеры (абстракция)
  payouts/         — выводы средств, холды
  wallet/          — пользовательский кошелёк (вьюха поверх ledger)
  chat/            — диалоги, сообщения, WS-gateway, маскирование
  reviews/         — отзывы и агрегаты рейтинга
  disputes/        — споры, арбитраж, резолюции
  trust/           — антифрод, риск-скоринг, репорты, блокировки
  moderation/      — очередь модерации, действия, аудит
  notifications/   — email/push/in-app, шаблоны
  promotions/      — промокоды, продвижение лотов
  admin/           — управление платформой, настройки, RBAC
  shared/          — common: guards, interceptors, фильтры, конфиг
```

## 5. Сквозной поток: покупка с эскроу (happy path)

```mermaid
sequenceDiagram
    actor B as Покупатель
    participant Web as Next.js
    participant Api as NestJS API
    participant L as Ledger
    participant Pay as Платёж. провайдер
    participant Q as BullMQ
    actor S as Продавец

    B->>Web: «Купить лот»
    Web->>Api: POST /orders {listingId}
    Api->>Api: Order=CREATED, расчёт комиссии (FeeRule)
    Api-->>Web: реквизиты оплаты
    B->>Pay: оплата
    Pay-->>Api: webhook (идемпотентно)
    Api->>L: проводка: gateway → escrow(order)
    Api->>Api: Order=PAID
    Api->>Q: enqueue: notify seller, schedule auto-confirm
    Api-->>S: «Новый заказ, выдайте товар»
    S->>Api: пометить DELIVERED (или авто-выдача)
    Api->>Api: Order=DELIVERED
    B->>Api: «Подтвердить получение»
    Api->>L: проводка: escrow → seller_available + platform_revenue
    Api->>Api: Order=COMPLETED
    Note over Q: если покупатель молчит N дней —<br/>джоб авто-подтверждает
```

Полная машина состояний и проводки — в [03](03-escrow-and-ledger.md).

## 6. Стратегии выдачи (fulfillment) — расширяемость гибрида

`Order` ссылается на `FulfillmentStrategy` по типу лота:

| Стратегия | Когда | Как работает |
|-----------|-------|--------------|
| `ManualHandover` | аккаунты, валюта, услуги | Продавец передаёт данные в чате, помечает DELIVERED |
| `AutoKeyDelivery` | ключи/цифра | Воркер резервирует ключ из `inventory`, выдаёт после PAID |
| `ProviderTopUp` | пополнения/донат | Воркер вызывает провайдера, отслеживает статус |

Каждая стратегия — отдельный обработчик в `orders/fulfillment/`, общий интерфейс.
Это и есть «гибрид на одном ядре» из [00](00-vision-and-scope.md).

## 7. Согласованность и надёжность

- **Транзакции БД** для всех денежных операций; ledger-проводки атомарны.
- **Идемпотентность**: ключ на платежах, вебхуках, выдаче (`Idempotency-Key` / `providerRef`).
- **Outbox-паттерн**: события для воркеров пишутся в БД в той же транзакции, затем
  доставляются в очередь (надёжная доставка без потерь).
- **Распределённые локи** (Redis) на критичных секциях (резерв ключа, выплата).
- **Read-replica** для каталога/поиска; запись денег — только на primary.

## 8. Среды (environments)

| Среда | Назначение | Данные |
|-------|-----------|--------|
| `local` | Docker Compose на машине разработчика | seed-данные |
| `ci` | Прогон тестов/миграций в GitHub Actions | эфемерные |
| `staging` | Прод-подобная, интеграционные тесты, демо | анонимизир. |
| `production` | Боевая | реальные |

Подробнее — [08](08-infrastructure-devops.md).
