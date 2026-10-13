'use client';

import { apiFetch } from '@/lib/session';

/**
 * Оплата созданного заказа: через платёжный шлюз или с баланса.
 *
 * Пока шлюз — заглушка, оплата подтверждается её dev-кнопкой сразу. С
 * настоящим провайдером здесь появится переход на его страницу (`url` из
 * ответа deposit), и менять придётся только это место: кнопка «Купить» и
 * виджет пополнения платят одинаково.
 */
export async function payOrder(orderId: string, from: 'gateway' | 'balance'): Promise<void> {
  if (from === 'balance') {
    await apiFetch(`/orders/${orderId}/pay-from-balance`, { method: 'POST' });
    return;
  }
  const dep = await apiFetch<{ providerRef: string }>('/payments/deposit', {
    method: 'POST',
    body: JSON.stringify({ orderId }),
  });
  await apiFetch(`/payments/mock/callback?providerRef=${encodeURIComponent(dep.providerRef)}`, {
    method: 'POST',
  });
}
