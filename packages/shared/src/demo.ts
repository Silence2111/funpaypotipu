/**
 * Демо-витрина: продавцы из `seed-demo.ts`.
 *
 * Их лоты на сайте подписаны «Пример», чтобы наполненный для показа каталог
 * не выдавал себя за живой рынок. Список один — его читают и сид, и витрина.
 */
export const DEMO_EMAIL_DOMAIN = '@demo.gamemarket.local';

export const DEMO_SELLER_USERNAMES = ['novichok', 'stabilno', 'keystore'] as const;

export function isDemoSeller(username: string | null | undefined): boolean {
  return !!username && (DEMO_SELLER_USERNAMES as readonly string[]).includes(username);
}
