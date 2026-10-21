import { describe, expect, it } from 'vitest';
import { NOTIFY_GROUPS, NOTIFY_LABELS, notifyGroupOf, notifyLink, wantsNotify } from './notify';

describe('уведомления', () => {
  it('у каждого типа из групп есть подпись — колокольчик не покажет сырой ключ', () => {
    for (const g of NOTIFY_GROUPS) for (const t of g.types) expect(NOTIFY_LABELS[t]).toBeTruthy();
  });

  it('по умолчанию: письмом — заказы, в Telegram — и сообщения', () => {
    expect(wantsNotify(null, 'email', 'order_paid')).toBe(true);
    expect(wantsNotify(null, 'email', 'new_message')).toBe(false);
    expect(wantsNotify(null, 'telegram', 'new_message')).toBe(true);
  });

  it('пуши по умолчанию — как Telegram: их включают ради скорости', () => {
    expect(wantsNotify(null, 'push', 'new_message')).toBe(true);
    expect(wantsNotify(null, 'push', 'order_paid')).toBe(true);
    expect(wantsNotify({ push: { messages: false } }, 'push', 'new_message')).toBe(false);
    expect(wantsNotify({ push: { messages: false } }, 'telegram', 'new_message')).toBe(true);
  });

  it('пользователь выключил группу — канал молчит', () => {
    expect(wantsNotify({ telegram: { messages: false } }, 'telegram', 'new_message')).toBe(false);
    expect(wantsNotify({ telegram: { messages: false } }, 'telegram', 'order_paid')).toBe(true);
  });

  it('решения модерации письмом не выключаются', () => {
    expect(wantsNotify({ email: { moderation: false } }, 'email', 'account_status')).toBe(true);
    expect(wantsNotify({ email: { moderation: false } }, 'email', 'kyc_rejected')).toBe(true);
  });

  it('неизвестный тип — только на сайте', () => {
    expect(notifyGroupOf('something_new')).toBeNull();
    expect(wantsNotify(null, 'telegram', 'something_new')).toBe(false);
  });

  it('ссылки ведут туда, где действовать', () => {
    expect(notifyLink('order_paid', { orderId: 'o1' })).toBe('/orders/o1');
    expect(notifyLink('new_message', { conversationId: 'c1' })).toBe('/chat/c1');
    expect(notifyLink('dispute_opened', { orderId: 'o1', disputeId: 'd1' })).toBe('/disputes/d1');
    expect(notifyLink('payout_paid', {})).toBe('/cabinet');
    expect(notifyLink('kyc_rejected', { reason: 'Размыто' })).toBe('/cabinet/verification');
    expect(notifyLink('seller_new_lots', { sellerId: 's1', listingId: 'l1' })).toBe('/lot/l1');
    expect(notifyLink('seller_sale', { sellerId: 's1', count: 3 })).toBe('/prodavec/s1');
  });
});
