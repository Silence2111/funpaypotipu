# 12 — Деплой

Артефакты для боевого развёртывания. В текущем окружении разработки Docker недоступен,
поэтому образы здесь не собирались — манифесты написаны по best practices и подлежат
проверке на инфраструктуре с Docker/Kubernetes.

## Варианты

| Способ | Когда | Файлы |
|--------|-------|-------|
| **Kubernetes** | прод, масштаб, HA | `infra/k8s/*` + `.github/workflows/deploy.yml` |
| **Docker Compose на VPS** | небольшой прод / стейджинг | `infra/compose.prod.yaml` |

## CI/CD (GitHub Actions)

- **CI** (`ci.yml`): на каждый PR — install → prisma generate → build → typecheck → lint →
  test, плюс job `e2e` с сервисом Postgres (миграции + сид + сквозные тесты денежных путей).
- **Deploy** (`deploy.yml`): на тег `vX.Y.Z` — сборка и push образов api/web/worker в GHCR
  (multi-stage Dockerfile'ы из `apps/*/Dockerfile`), затем `kubectl set image` + одноразовый
  Job миграции + `rollout status`.

Требуемые секреты репозитория: `KUBECONFIG` (base64). Переменные: `NEXT_PUBLIC_API_URL`,
`NEXT_PUBLIC_SITE_URL` (инлайнятся в web на сборке).

## Kubernetes — первый деплой

```bash
# 1. Заменить OWNER на свой GHCR-неймспейс во всех infra/k8s/*.yaml
# 2. Заполнить секреты (или подключить External Secrets / SealedSecrets)
kubectl apply -f infra/k8s/00-namespace-config.yaml
kubectl apply -f infra/k8s/10-api.yaml -f infra/k8s/11-worker.yaml -f infra/k8s/12-web.yaml
kubectl apply -f infra/k8s/20-ingress.yaml
# миграции
TAG=v1.0.0 envsubst < infra/k8s/migrate-job.yaml | kubectl apply -f -
```

Дальнейшие релизы — пуш тега `vX.Y.Z`, остальное делает `deploy.yml`.

## Docker Compose на VPS

```bash
cp .env.example .env.production   # заполнить боевыми значениями
IMAGE_OWNER=you IMAGE_TAG=v1.0.0 \
  docker compose -f infra/compose.prod.yaml --env-file .env.production up -d
```

`migrate` применяет миграции и сид, затем стартуют `api`/`web`/`worker`. Datastore'ы
(Postgres/Redis/MinIO/Meilisearch) — либо managed (адреса в `.env.production`), либо
добавьте их в этот compose.

## Управляемые сервисы (рекомендация для прода)

| Компонент | Managed-вариант |
|-----------|-----------------|
| PostgreSQL | RDS / Cloud SQL / managed PG (бэкапы + PITR) |
| Redis | ElastiCache / managed Redis |
| Объекты | S3 / GCS (вместо self-hosted MinIO) |
| Поиск | Meilisearch Cloud / self-hosted с бэкапом индекса |
| Почта | SES / Postmark / боевой SMTP |
| Антивирус | clamd (sidecar/сервис), `CLAMAV_HOST` |

## Чек-лист перед прод-запуском

- [ ] Все секреты сгенерированы (`openssl rand -base64 48`), не дефолтные.
- [ ] Реальный `PaymentProvider` вместо `mock` (класс + ключи шлюза, вебхук-подпись).
- [ ] TLS (cert-manager / внешний LB), HSTS.
- [ ] Бэкапы Postgres (PITR) и объектного хранилища; тест восстановления.
- [ ] Observability: логи (pino), метрики, Sentry, алерты на падение оплат/рост ошибок.
- [ ] Рейт-лимиты на auth/платежах; ревью прав и ротация секретов.
