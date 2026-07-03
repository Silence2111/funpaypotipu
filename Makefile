COMPOSE = docker compose -f infra/compose.yaml

.PHONY: up down logs ps migrate seed build restart

## Поднять весь стек (БД + приложения), собрав образы
up:
	$(COMPOSE) up -d --build

## Остановить и удалить контейнеры
down:
	$(COMPOSE) down

## Логи всех сервисов
logs:
	$(COMPOSE) logs -f

## Статус сервисов
ps:
	$(COMPOSE) ps

## Применить миграции (одноразовый сервис)
migrate:
	$(COMPOSE) run --rm migrate

## Пересобрать образы без кэша
build:
	$(COMPOSE) build --no-cache

## Перезапустить приложения
restart:
	$(COMPOSE) restart api web worker
