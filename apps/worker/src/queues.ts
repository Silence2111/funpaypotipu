/** Имена очередей — единый реестр для воркера и продюсеров (API). */
export const QUEUES = {
  orderAutoConfirm: 'order-auto-confirm',
  fulfillment: 'fulfillment',
  notifications: 'notifications',
  paymentWebhooks: 'payment-webhooks',
  searchIndex: 'search-index',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface OrderAutoConfirmJob {
  orderId: string;
}
