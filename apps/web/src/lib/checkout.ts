'use client';

import { apiFetch } from '@/lib/session';
import type { PayMethod } from '@/components/pay-methods';

export interface Deposit {
  providerRef: string;
  url: string;
  /** true — платить на странице шлюза (ЮKassa); false — заглушка, подтверждается здесь. */
  redirect: boolean;
}

/**
 * Платёж создан: настоящий шлюз — переход на его страницу оплаты, заглушка —
 * её dev-кнопка «оплачено» сразу. 'redirect' — страница уже уходит.
 */
export async function completeDeposit(dep: Deposit): Promise<'paid' | 'redirect'> {
  if (dep.redirect) {
    window.location.assign(dep.url);
    return 'redirect';
  }
  await apiFetch(`/payments/mock/callback?providerRef=${encodeURIComponent(dep.providerRef)}`, {
    method: 'POST',
  });
  return 'paid';
}

/**
 * Оплата созданного заказа выбранным способом: с баланса или через шлюз.
 *
 * Шлюз берёт сумму заказа плюс надбавку способа (карта +4.4%) — ту же, что
 * показана в выборе способа. ЮKassa открывает свою страницу оплаты и
 * возвращает на заказ с ?paid=1, где страница ждёт подтверждения.
 * Кнопка «Оплатить», виджет пополнения и страница заказа платят одинаково.
 */
export async function payOrder(orderId: string, method: PayMethod): Promise<'paid' | 'redirect'> {
  if (method === 'balance') {
    await apiFetch(`/orders/${orderId}/pay-from-balance`, { method: 'POST' });
    return 'paid';
  }
  const dep = await apiFetch<Deposit>('/payments/deposit', {
    method: 'POST',
    body: JSON.stringify({ orderId, method }),
  });
  return completeDeposit(dep);
}
