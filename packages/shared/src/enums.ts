/**
 * Доменные значения статусов — единый источник для фронта и бэка.
 * Совпадают со строковыми значениями enum'ов Prisma (см. packages/db/prisma/schema.prisma).
 */

export const ORDER_STATUS = [
  'created',
  'paid',
  'delivered',
  'completed',
  'disputed',
  'refunded',
  'cancelled',
  'expired',
] as const;
export type OrderStatus = (typeof ORDER_STATUS)[number];

/** Разрешённые переходы машины состояний заказа (см. docs/03). */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  created: ['paid', 'cancelled', 'expired'],
  paid: ['delivered', 'disputed', 'refunded'],
  delivered: ['completed', 'disputed'],
  disputed: ['refunded', 'completed'],
  completed: [],
  refunded: [],
  cancelled: [],
  expired: [],
};

export const canTransition = (from: OrderStatus, to: OrderStatus): boolean =>
  ORDER_TRANSITIONS[from]?.includes(to) ?? false;

export const CATEGORY_SEGMENT = [
  'accounts',
  'currency',
  'items',
  'service',
  'key',
  'topup',
] as const;
export type CategorySegment = (typeof CATEGORY_SEGMENT)[number];

export const FULFILLMENT_TYPE = ['manual', 'auto_key', 'provider'] as const;
export type FulfillmentType = (typeof FULFILLMENT_TYPE)[number];

export const DISPUTE_STATUS = [
  'open',
  'in_review',
  'resolved_buyer',
  'resolved_seller',
  'cancelled',
] as const;
export type DisputeStatus = (typeof DISPUTE_STATUS)[number];
