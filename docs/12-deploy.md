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

## Один VPS с нуля — `infra/compose.prod.yaml`

Всё на одном сервере: Postgres, API, сайт, Caddy с HTTPS, ночной бэкап и
сторож. Redis, MinIO, Meilisearch и воркер не нужны: поиск — по Postgres,
файлы — на томе сервера под подписанными ссылками API, фоновые задачи — в
самом API. Тот же путь каждый прогон проходит CI (задание `stack`): сборка
образов, запуск с нуля, проверка снаружи, бэкап и восстановление.

**Сервер:** Ubuntu 24.04, от 2 CPU и 4 ГБ памяти (сборка сайта занимает
около 2 ГБ), 40 ГБ диска. Открыты 22, 80 и 443.

1. **Домен.** Запись A на IP сервера; дождаться, пока `dig +short домен`
   вернёт этот IP, — иначе Caddy не получит сертификат.
2. **Docker.**
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
   Если образы с Docker Hub не качаются (бывает с российских адресов) —
   зеркало реестра хостера в `/etc/docker/daemon.json`
   (`{"registry-mirrors": ["https://…"]}`) и `systemctl restart docker`.
3. **Код и настройки.**
   ```bash
   git clone https://github.com/Silence2111/funpaypotipu.git /opt/gamemarket && cd /opt/gamemarket
   cp infra/.env.production.example infra/.env.production
   for k in POSTGRES_PASSWORD JWT_ACCESS_SECRET JWT_REFRESH_SECRET DATA_ENCRYPTION_KEY; do
     sed -i "s|^$k=.*|$k=$(openssl rand -hex 32)|" infra/.env.production
   done
   nano infra/.env.production   # PUBLIC_URL=https://домен, ЮKassa, почта, вход, Telegram
   ```
   Секреты — копию в надёжное место: без `DATA_ENCRYPTION_KEY` ключи товаров
   и реквизиты выплат из бэкапа не расшифровать. С пустыми или короткими
   секретами API в проде не запускается.
4. **Запуск.**
   ```bash
   C="docker compose -f infra/compose.prod.yaml --env-file infra/.env.production"
   $C up -d --build      # первая сборка — 5–10 минут
   $C ps                 # migrate — Exited (0), остальные — healthy / running
   ```
   `migrate` применяет миграции и сид (роли, правила комиссий, каталог) и
   завершается; API ждёт его, сайт ждёт API, Caddy — их обоих.
5. **Проверка снаружи.**
   ```bash
   bash infra/ops/smoke.sh https://домен
   ```
   API с базой, главная с каталогом с сервера, регистрация, фото лота —
   загрузка и чтение. Пользователь `smoke_…` остаётся — его можно
   заморозить в консоли.
6. **Первый администратор.** Зарегистрироваться на сайте, затем
   ```bash
   $C exec postgres psql -U gamemarket -c "INSERT INTO user_roles (user_id, role_id)
     SELECT p.user_id, r.id FROM profiles p, roles r WHERE p.username = 'ваш_ник' AND r.key = 'admin'"
   ```
   Остальным ролям — в консоли, раздел «Пользователи».

**Бэкап.** Каждую ночь в 03:00 по Москве сервис `backup` кладёт в
`infra/backups` дамп базы и архив файлов, старше `BACKUP_KEEP_DAYS` (14)
удаляются. Дамп после записи читается обратно — битый файл не останется
«успешным». Руками: `$C exec backup /ops/backup.sh`.

**Копия вне сервера — обязательно**: сервер умирает вместе со своими
бэкапами. С другой машины раз в сутки:
`rsync -a root@сервер:/opt/gamemarket/infra/backups/ ./gamemarket-backups/`
— или выгрузка в объектное хранилище.

**Проверка бэкапа — без остановки прода:** восстановить в отдельную базу
рядом и сравнить.
```bash
$C exec -e RESTORE_DB=gamemarket_check backup /ops/restore.sh /backups/db-YYYYMMDD-HHMM.dump
$C exec postgres psql -U gamemarket -d gamemarket_check -c "SELECT count(*) FROM users"
```

**Восстановление после аварии:**
```bash
$C stop api web
$C run --rm --entrypoint /ops/restore.sh backup \
  /backups/db-YYYYMMDD-HHMM.dump /backups/uploads-YYYYMMDD-HHMM.tar.gz
$C up -d
```
На новом сервере — шаги 1–4 с тем же `infra/.env.production` (тот же
`DATA_ENCRYPTION_KEY`!), бэкапы — в `infra/backups`, затем восстановление.

**Сторож.** Раз в минуту — готовность API (с базой) и главная сайта;
упало или поднялось — сообщение в Telegram (`ALERT_BOT_TOKEN`,
`ALERT_CHAT_ID`) и строка в `$C logs healthwatch`. Docker сам перезапускает
упавшие контейнеры (`restart: unless-stopped`).

**Журналы.** `$C logs -f api` (или `web`, `caddy`, `backup`); у каждого
контейнера — до 5 файлов по 10 МБ, старые удаляются сами.

**Обновление.** `git pull && $C up -d --build` — `migrate` применит новые
миграции до старта нового API.

## Управляемые сервисы (рекомендация для прода)

| Компонент | Managed-вариант |
|-----------|-----------------|
| PostgreSQL | RDS / Cloud SQL / managed PG (бэкапы + PITR), версия 13+ с расширениями `pg_trgm` и `btree_gin` — их включает миграция поиска в «Заказах»; в управляемом PG их иногда сначала разрешают в настройках кластера |
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
- [ ] В Postgres доступны расширения `pg_trgm` и `btree_gin` (иначе `prisma migrate deploy` остановится на `20261030100000_orders_search_trgm`).
- [ ] Ответы API сжимает сам API (brotli/gzip, кроме `/api/auth`); прокси перед ним может сжимать и своё — уже сжатое он второй раз не трогает.
- [ ] Observability: логи (pino), метрики, Sentry, алерты на падение оплат/рост ошибок.
- [ ] Рейт-лимиты на auth/платежах; ревью прав и ротация секретов.
