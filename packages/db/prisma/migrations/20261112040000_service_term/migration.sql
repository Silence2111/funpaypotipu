-- Услуги со сроком выполнения (часть 125): срок у лота, «выполнить до»,
-- «взято в работу» и отметка о просрочке у заказа.
ALTER TABLE "listings" ADD COLUMN     "service_hours" INTEGER;

ALTER TABLE "orders" ADD COLUMN     "service_due_at" TIMESTAMP(3),
ADD COLUMN     "service_overdue_at" TIMESTAMP(3),
ADD COLUMN     "service_started_at" TIMESTAMP(3);
