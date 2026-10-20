import type { MetadataRoute } from 'next';
import { getT } from '@/lib/i18n/server';

/**
 * Сайт ставится на телефон как приложение: «На экран „Домой“» открывает его
 * без адресной строки, со своей иконкой. Ярлыки — частые места продавца и
 * покупателя: сообщения, заказы, лоты. Язык — как у сайта: браузер
 * запрашивает манифест со своими языками (cookie выбора может не прийти).
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getT();
  return {
    id: '/',
    name: t('GameMarket — игровые ценности с защитой сделки'),
    short_name: 'GameMarket',
    description: t(
      'Аккаунты, валюта, предметы, ключи и пополнения от продавцов. Деньги у площадки, пока вы не подтвердите получение.',
    ),
    lang: t.lang,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#F4F5F7',
    theme_color: '#FFFFFF',
    categories: ['games', 'shopping'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: t('Сообщения'), url: '/chat' },
      { name: t('Заказы'), url: '/cabinet/orders' },
      { name: t('Мои лоты'), url: '/cabinet/lots' },
    ],
  };
}
