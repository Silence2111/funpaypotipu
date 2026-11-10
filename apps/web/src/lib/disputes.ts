import { msg } from './i18n/lang';

/** Статус спора словами — на странице спора и в «Спорах» кабинета; показывать через t(). */
export const DISPUTE_STATUS: Record<string, string> = {
  open: msg('ждёт арбитра'),
  in_review: msg('на рассмотрении у арбитра'),
  resolved_seller: msg('решён в пользу продавца'),
  resolved_buyer: msg('решён в пользу покупателя'),
  cancelled: msg('закрыт'),
};
