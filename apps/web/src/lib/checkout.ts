'use client';

import { apiFetch } from '@/lib/session';
import type { PayMethod } from '@/components/pay-methods';

/**
 * Оплата созданного заказа выбранным способом: с баланса или через шлюз.
 *
 * Шлюз берёт сумму заказа плюс надбавку способа (карта +4.4%) — ту же, что
 * показана в выборе способа. Пока шлюз — заглушка, оплата подтверждается её
 * dev-кнопкой сразу. С настоящим провайдером здесь появится переход на его
 * страницу (`url` из ответа deposit), и менять придётся только это место:
 * кнопка «Оплатить», виджет пополнения и страница заказа платят одинаково.
 */
export async function payOrder(orderId: string, method: PayMethod): Promise<void> {
  if (method === 'balance') {
    await apiFetch(`/orders/${orderId}/pay-from-balance`, { method: 'POST' });
    return;
  }
  const dep = await apiFetch<{ providerRef: string }>('/payments/deposit', {
    method: 'POST',
    body: JSON.stringify({ orderId, method }),
  });
  await apiFetch(`/payments/mock/callback?providerRef=${encodeURIComponent(dep.providerRef)}`, {
    method: 'POST',
  });
}
