import { describe, expect, it } from 'vitest';
import { isServiceTerm, serviceDueAt, serviceOverdue, SERVICE_TERM_HOURS } from './service-term';

describe('срок выполнения услуги', () => {
  it('срок — только из списка, в часах', () => {
    expect(SERVICE_TERM_HOURS).toEqual([24, 48, 72, 120, 168, 336, 720]);
    expect(isServiceTerm(72)).toBe(true);
    expect(isServiceTerm(73)).toBe(false);
    expect(isServiceTerm(null)).toBe(false);
  });

  it('«выполнить до» — от оплаты плюс срок; вышел — только у невыполненного', () => {
    const due = serviceDueAt(new Date('2026-11-11T10:00:00Z'), 72);
    expect(due.toISOString()).toBe('2026-11-14T10:00:00.000Z');
    const after = new Date('2026-11-14T10:00:01Z');
    expect(serviceOverdue({ status: 'paid', serviceDueAt: due }, after)).toBe(true);
    expect(serviceOverdue({ status: 'delivered', serviceDueAt: due }, after)).toBe(false);
    expect(serviceOverdue({ status: 'paid', serviceDueAt: due }, new Date('2026-11-13T10:00:00Z'))).toBe(false);
    expect(serviceOverdue({ status: 'paid', serviceDueAt: null }, after)).toBe(false);
  });
});
