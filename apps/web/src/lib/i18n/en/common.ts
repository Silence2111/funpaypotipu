/** Общее: шапка, подвал, нижняя панель, меню профиля, цены, «в сети». */
export const COMMON: Record<string, string> = {
  // Шапка и подвал
  'GameMarket — маркетплейс цифровых игровых товаров':
    'GameMarket — marketplace for digital game goods',
  'Безопасная покупка игровых аккаунтов, валюты, предметов, ключей и пополнений с защитой сделки (эскроу).':
    'Buy game accounts, currency, items, keys and top-ups safely, with escrow protection on every deal.',
  'лоты с пометкой «Пример» — демонстрационные': 'listings marked “Sample” are for demonstration',
  Документы: 'Documents',
  Помощь: 'Help',
  'Правила и гарантии': 'Rules and guarantees',
  Оферта: 'Terms of service',
  'Персональные данные': 'Personal data',
  Контакты: 'Contacts',
  'Как мы меряем выдачу': 'How we measure delivery',
  'Валюта цен': 'Price currency',
  'Валюта показа цен. Оплата — в рублях.': 'Currency for displaying prices. Payment is in rubles.',
  'Примерно, по курсу площадки. Оплата — в рублях.':
    'Approximate, at the marketplace rate. Payment is in rubles.',
  'Установить приложение': 'Install app',
  'Каталог игр': 'Game catalog',
  'Предложения продавцов': 'Offers from sellers',
  'Покупка с защитой сделки': 'Purchase with escrow protection',
  'GameMarket — игровые ценности с защитой сделки':
    'GameMarket — game goods with escrow protection',
  'Аккаунты, валюта, предметы, ключи и пополнения от продавцов. Деньги у площадки, пока вы не подтвердите получение.':
    'Accounts, currency, items, keys and top-ups from sellers. The marketplace holds the money until you confirm receipt.',
  'Язык сайта': 'Site language',
  Каталог: 'Catalog',
  Продать: 'Sell',
  'Поиск по играм': 'Search games',
  'Переключить тему': 'Toggle theme',
  'Светлая тема': 'Light theme',
  'Тёмная тема': 'Dark theme',

  'Черновик до регистрации юрлица. Места с пометкой «[заполнить]» — реквизиты, которых пока нет.':
    'Draft until the company is registered. Highlighted placeholders are details we don’t have yet.',
  'Этот документ — только на русском. Действует русская версия.':
    'This document is available in Russian only. The Russian version is the one that applies.',

  // 404
  'Страница не найдена': 'Page not found',
  'Похоже, этот лот уже купили, а страницу — телепортировали. Но в каталоге ещё много всего.':
    'Looks like this listing has been sold and the page teleported away. There’s plenty more in the catalog.',
  'В каталог': 'Go to catalog',
  'На главную': 'Home page',

  // Нижняя панель и меню профиля
  'Разделы сайта': 'Site sections',
  Главная: 'Home',
  Войти: 'Sign in',
  Сообщения: 'Messages',
  'Сообщения: {n} непрочитанных': 'Messages: {n} unread',
  Профиль: 'Profile',
  'Профиль: {n} ждут действия': 'Profile: {n} need action',
  'Меню профиля {name}': 'Profile menu for {name}',
  'Баланс {sum}': 'Balance {sum}',
  'Баланс — пополнить и вывести в кошельке': 'Balance — top up and withdraw in your wallet',
  Продажи: 'Sales',
  '{n} ждут выдачи': '{n} to deliver',
  Покупки: 'Purchases',
  '{n} ждут подтверждения': '{n} to confirm',
  'Мои лоты': 'My listings',
  '[скрыто]': '[hidden]',
  Кошелёк: 'Wallet',
  'Мой профиль на витрине': 'My public profile',
  Избранное: 'Favorites',
  Поиски: 'Searches',
  'Сохранённые поиски': 'Saved searches',
  Настройки: 'Settings',
  Безопасность: 'Security',
  Поддержка: 'Support',
  'Консоль сотрудника': 'Staff console',
  Выйти: 'Sign out',

  // Уведомления
  Уведомления: 'Notifications',
  'Прочитать все': 'Mark all as read',
  'Уведомлений нет': 'No notifications',
  'Настроить уведомления': 'Notification settings',
  Уведомление: 'Notification',

  // Типы товаров и виды игр
  Аккаунты: 'Accounts',
  Валюта: 'Currency',
  Предметы: 'Items',
  Ключи: 'Keys',
  Донат: 'Top-ups',
  Услуги: 'Services',
  Игры: 'Games',
  'Мобильные игры': 'Mobile games',
  'Приложения и сервисы': 'Apps and services',

  // Цены и количество
  'за {qty}': 'per {qty}',
  'от {price}': 'from {price}',

  // В сети
  'в сети': 'online',
  'в сети {n} мин назад': 'seen {n} min ago',
  'в сети {n} ч назад': 'seen {n} h ago',
  'в сети {n} дн назад': 'seen {n} d ago',
  'Обычно отвечает': 'Usually replies',
  'обычно отвечает {when}': 'usually replies {when}',
  'за 5 минут': 'within 5 minutes',
  'за 15 минут': 'within 15 minutes',
  'за час': 'within an hour',
  'за 3 часа': 'within 3 hours',
  'в течение дня': 'within a day',
  Инструменты: 'Tools',
  'Инструменты продавца': 'Seller tools',

  'Аккаунт удалён. До {date} его можно вернуть: войдите и нажмите «Восстановить». Потом почта, имя и вход будут уничтожены.':
    'Account deleted. Until {date} you can restore it: sign in and press “Restore”. After that your email, name and sign-in are erased.',
  // Приложение (часть 139)
  'Приложение': 'App',
  'Приложение GameMarket': 'GameMarket app',
  'GameMarket на телефоне: Android — Google Play и RuStore, iPhone — с экрана «Домой». Уведомления о заказах и сообщениях.':
    'GameMarket on your phone: Android via Google Play and RuStore, iPhone from the Home Screen. Notifications about orders and messages.',
  'Заказы, сообщения и уведомления — с иконки на телефоне, без адресной строки.': 'Orders, messages and notifications from an icon on your phone, without the address bar.',
  'Скоро в Google Play и RuStore. Пока — установите с сайта: откройте GameMarket в Chrome и нажмите «Установить приложение» внизу страницы или в меню браузера.':
    'Coming soon to Google Play and RuStore. For now, install it from the site: open GameMarket in Chrome and tap “Install app” at the bottom of the page or in the browser menu.',
  'iPhone присылает уведомления только сайтам с экрана «Домой» — без установки пушей не будет.': 'iPhone only sends notifications to sites added to the Home Screen — without installing, there are no push notifications.',
  'Настройки уведомлений': 'Notification settings',
  'Установить на iPhone': 'Install on iPhone',
  'Откройте сайт в Safari и нажмите «Поделиться» внизу экрана.': 'Open the site in Safari and tap “Share” at the bottom of the screen.',
  'Выберите «На экран „Домой“» и нажмите «Добавить».': 'Choose “Add to Home Screen” and tap “Add”.',
  'Откройте GameMarket с иконки и включите уведомления: «Профиль» → «Настройки» → «Уведомления».': 'Open GameMarket from the icon and turn on notifications: Profile → Settings → Notifications.',
};
