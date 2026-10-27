-- Напоминание о сроке ответа в споре: о каком сроке уже напомнили. Новый
-- срок от арбитра — новое напоминание; у прежних споров — пусто.

-- AlterTable
ALTER TABLE "disputes" ADD COLUMN     "reminded_for" TIMESTAMP(3);
