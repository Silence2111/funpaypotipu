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
    // Окно установки в Chrome и карточка приложения: экраны с телефона и компьютера.
    screenshots: [
      {
        src: '/screenshots/phone-home.jpg',
        sizes: '780x1688',
        type: 'image/jpeg',
        form_factor: 'narrow',
        label: t('Каталог игр'),
      },
      {
        src: '/screenshots/phone-section.jpg',
        sizes: '780x1688',
        type: 'image/jpeg',
        form_factor: 'narrow',
        label: t('Предложения продавцов'),
      },
      {
        src: '/screenshots/phone-lot.jpg',
        sizes: '780x1688',
        type: 'image/jpeg',
        form_factor: 'narrow',
        label: t('Покупка с защитой сделки'),
      },
      {
        src: '/screenshots/wide-home.jpg',
        sizes: '1280x800',
        type: 'image/jpeg',
        form_factor: 'wide',
        label: t('Каталог игр'),
      },
    ],
    shortcuts: [
      { name: t('Сообщения'), url: '/chat' },
      { name: t('Заказы'), url: '/cabinet/orders' },
      { name: t('Мои лоты'), url: '/cabinet/lots' },
    ],
  };
}
