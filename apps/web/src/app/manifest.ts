import type { MetadataRoute } from 'next';

/**
 * Сайт ставится на телефон как приложение: «На экран „Домой“» открывает его
 * без адресной строки, со своей иконкой. Ярлыки — частые места продавца и
 * покупателя: сообщения, заказы, лоты.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'GameMarket — игровые ценности с защитой сделки',
    short_name: 'GameMarket',
    description: 'Аккаунты, валюта, предметы, ключи и пополнения от продавцов. Деньги у площадки, пока вы не подтвердите получение.',
    lang: 'ru',
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
      { name: 'Сообщения', url: '/chat' },
      { name: 'Заказы', url: '/cabinet/orders' },
      { name: 'Мои лоты', url: '/cabinet/lots' },
    ],
  };
}
