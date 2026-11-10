import { describe, expect, it } from 'vitest';
import { BUY_REQUEST_DAYS, buyRequestExpiry, buyRequestState, withinBudget } from './buy-request';
import { notifyGroupOf, notifyLink, wantsNotify } from './notify';

describe('запросы покупателей', () => {
  const now = new Date('2026-11-11T12:00:00Z');

  it('открытый после срока — истёк; закрытый и снятый — как есть', () => {
    expect(buyRequestState({ status: 'open', expiresAt: '2026-11-12T00:00:00Z' }, now)).toBe('open');
    expect(buyRequestState({ status: 'open', expiresAt: now }, now)).toBe('expired');
    expect(buyRequestState({ status: 'open', expiresAt: '2026-11-01T00:00:00Z' }, now)).toBe('expired');
    expect(buyRequestState({ status: 'closed', expiresAt: '2026-11-20T00:00:00Z' }, now)).toBe('closed');
    expect(buyRequestState({ status: 'removed', expiresAt: '2026-11-20T00:00:00Z' }, now)).toBe('removed');
  });

  it(`срок — ${BUY_REQUEST_DAYS} дней`, () => {
    expect(buyRequestExpiry(now).toISOString()).toBe('2026-11-18T12:00:00.000Z');
  });

  it('«до какой цены»: без предела — любой лот, иначе не дороже', () => {
    expect(withinBudget(150000n, null)).toBe(true);
    expect(withinBudget('100000', '100000')).toBe(true);
    expect(withinBudget(100001, 100000n)).toBe(false);
  });

  it('уведомления — своя группа; ответ продавца ведёт на лот, новый запрос — в кабинет', () => {
    expect(notifyGroupOf('buy_request')).toBe('requests');
    expect(notifyGroupOf('buy_request_offer')).toBe('requests');
    expect(notifyLink('buy_request_offer', { requestId: 'r1', listingId: 'l1' })).toBe('/lot/l1');
    expect(notifyLink('buy_request', { requestId: 'r1' })).toBe('/cabinet/requests?r=r1');
    expect(notifyLink('buy_request', {})).toBe('/cabinet/requests');
    // Письмом — нет по умолчанию, в Telegram и пушем — да, как у поисков.
    expect(wantsNotify(null, 'email', 'buy_request')).toBe(false);
    expect(wantsNotify(null, 'telegram', 'buy_request')).toBe(true);
    expect(wantsNotify(null, 'push', 'buy_request_offer')).toBe(true);
  });
});
