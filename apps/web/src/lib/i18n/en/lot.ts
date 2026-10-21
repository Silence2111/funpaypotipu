/** Страница лота и профиль продавца: покупка, способы оплаты, галерея, чат с продавцом, отзывы, жалобы. */
export const LOT: Record<string, string> = {
  // Страница лота
  да: 'yes',
  нет: 'no',
  'Лот не найден': 'Listing not found',
  'Все игры': 'All games',
  'Лот опубликован и уже виден в каталоге.':
    'The listing is published and already visible in the catalog.',
  'Лот создан. Загрузите ключи на склад ниже — с первым ключом он появится в каталоге.':
    'Listing created. Upload keys to the stock below — it will appear in the catalog with the first key.',
  'Лот создан. Загрузите товар на склад ниже — с первой строкой он появится в каталоге.':
    'Listing created. Upload goods to the stock below — it will appear in the catalog with the first line.',
  'Лот создан. Наличие — ноль: лот появится в каталоге, когда вы его пополните.':
    'Listing created. Stock is zero: the listing will appear in the catalog once you restock it.',
  'Изменения сохранены и уже видны в каталоге.':
    'Changes saved and already visible in the catalog.',
  'Автовыдача включена. Загрузите товар на склад ниже — с первой строкой лот вернётся в каталог.':
    'Auto-delivery is on. Upload goods to the stock below — the listing returns to the catalog with the first line.',
  'Ключ сразу после оплаты': 'Key right after payment',
  'Выдача сразу после оплаты': 'Delivered right after payment',
  'Пополнение по логину': 'Top-up by login',
  'Пополнение по игровому ID': 'Top-up by game ID',
  'Выдаёт продавец': 'Delivered by the seller',
  Пример: 'Sample',
  Закончился: 'Out of stock',
  'Продаж: {n}': 'Sales: {n}',
  Покупка: 'Purchase',
  'Сумму выбираете вы, наценка продавца — {pct}':
    'You choose the amount, the seller’s markup is {pct}',
  'Количество выбираете вы, от {qty}': 'You choose the quantity, from {qty}',
  'Количество выбираете вы': 'You choose the quantity',
  'Лот закончился': 'Out of stock',
  'Продавец может пополнить наличие. Добавьте лот в избранное, чтобы не потерять его, или посмотрите похожие предложения ниже.':
    'The seller may restock it. Add the listing to favorites so you don’t lose it, or see similar offers below.',
  'Демо-оплата: платёжка не подключена, деньги не списываются.':
    'Demo payment: no payment provider is connected, no money is charged.',
  'Как защищена покупка': 'How your purchase is protected',
  'Деньги лежат у площадки. Продавец получит их, только когда вы подтвердите получение.':
    'The marketplace holds the money. The seller gets it only after you confirm receipt.',
  'Ключ выдаётся сразу. Не выдался — деньги вернутся на баланс автоматически.':
    'The key is delivered instantly. If it isn’t, the money returns to your balance automatically.',
  'Товар выдаётся со склада продавца сразу. Не выдался — деньги вернутся на баланс автоматически.':
    'The goods are delivered instantly from the seller’s stock. If they aren’t, the money returns to your balance automatically.',
  'Пополнение уходит сразу после оплаты. Не прошло — деньги вернутся на баланс автоматически.':
    'The top-up is sent right after payment. If it fails, the money returns to your balance automatically.',
  'Продавец не выдал товар за {h} ч — деньги вернутся на баланс автоматически.':
    'If the seller doesn’t deliver within {h} h, the money returns to your balance automatically.',
  'После выдачи у вас {h} ч на проверку: подтвердить или открыть спор с арбитром.':
    'After delivery you have {h} h to check: confirm, or open a dispute with an arbiter.',
  '+{pct}% кэшбэк на баланс после подтверждения':
    '+{pct}% cashback to your balance after confirmation',
  'Это пример лота: по нему видно, как устроена сделка. Купить можно — оплата на стенде демонстрационная, а ключ придёт с пометкой «ПРИМЕР» и в игре не активируется.':
    'This is a sample listing that shows how a deal works. You can buy it — payment here is simulated, and the key comes marked as a sample and won’t activate in the game.',
  'Это пример лота: по нему видно, как устроена сделка. Купить можно — оплата на стенде демонстрационная.':
    'This is a sample listing that shows how a deal works. You can buy it — payment here is simulated.',
  Параметры: 'Details',
  Раздел: 'Category',
  Описание: 'Description',
  'Похожие предложения': 'Similar offers',
  'Весь раздел →': 'Whole category →',
  'У других продавцов этого раздела — сначала дешёвые':
    'From other sellers in this category, cheapest first',
  'Ещё у продавца': 'More from this seller',
  'Все →': 'All →',
  'Пополнить аккаунт': 'Top up account',
  Купить: 'Buy',
  'Отзывы о продавце': 'Seller reviews',

  // Профиль и карточка продавца
  'Продавец не найден': 'Seller not found',
  'Рейтинг {r}, {reviews}.': 'Rating {r}, {reviews}.',
  '{name} — продавец на GameMarket': '{name} — seller on GameMarket',
  Продавец: 'Seller',
  'в отпуске': 'on vacation',
  'не в сети': 'offline',
  'Документы проверены': 'ID verified',
  Рейтинг: 'Rating',
  'отзывов пока нет': 'no reviews yet',
  Отзывы: 'Reviews',
  Продаж: 'Sales',
  'На сайте': 'On the site',
  'Оценки покупателей': 'Buyer ratings',
  Предложения: 'Offers',
  'Все предложения': 'All offers',
  'Продавец в отпуске — предложения вернутся вместе с ним.':
    'The seller is on vacation — their offers will return with them.',
  'Сейчас у продавца нет активных предложений.': 'The seller has no active offers right now.',
  'показаны первые {n}': 'showing the first {n}',
  'Добавить {name} в чёрный список? Он не сможет писать вам до сделки и покупать ваши лоты.':
    'Add {name} to your blocklist? They won’t be able to message you before a deal or buy your listings.',
  'Не получилось. Попробуйте ещё раз.': 'That didn’t work. Try again.',
  'В чёрном списке': 'Blocked',
  'В чёрный список': 'Block',
  'Изменить лот': 'Edit listing',
  'В избранное': 'Add to favorites',
  'В избранном': 'In favorites',

  // Покупка
  'Укажите игровой ID и отметьте, что он верный': 'Enter your game ID and confirm it’s correct',
  'Не удалось оформить заказ. Обновите страницу и попробуйте ещё раз.':
    'Couldn’t place the order. Refresh the page and try again.',
  Количество: 'Quantity',
  'От {qty}': 'From {qty}',
  'в наличии {qty}': '{qty} in stock',
  необязательно: 'optional',
  'Продавец увидит это в заказе — переписываться не придётся.':
    'The seller will see this in the order — no need to message back and forth.',
  'Игровой ID или логин': 'Game ID or login',
  'Например, 812345678': 'For example, 812345678',
  'ID верный. Пополнение придёт на этот аккаунт, при ошибке в ID вернуть его нельзя':
    'The ID is correct. The top-up goes to this account and can’t be returned if the ID is wrong',
  'Есть промокод?': 'Have a promo code?',
  Промокод: 'Promo code',
  'Например, START10': 'For example, START10',
  'Скидка учтётся в сумме заказа при оплате.':
    'The discount is applied to the order total at payment.',
  'Оформляем заказ…': 'Placing the order…',
  'Оплатить {sum}': 'Pay {sum}',
  Оплатить: 'Pay',

  // Способы оплаты
  СБП: 'SBP (Faster Payments)',
  'Карта, Apple Pay, Google Pay': 'Card, Apple Pay, Google Pay',
  'Криптовалюта, USDT': 'Crypto, USDT',
  'С баланса': 'From balance',
  'на балансе {sum}': '{sum} on balance',
  'комиссия способа {fee}': 'method fee {fee}',
  'Способ оплаты': 'Payment method',

  // Чат с продавцом
  'Сообщение не отправлено. Попробуйте ещё раз.': 'Message not sent. Try again.',
  'Ещё продаёте?': 'Still selling?',
  'Когда сможете выдать?': 'When can you deliver?',
  'Чат с продавцом': 'Chat with the seller',
  'Написать продавцу': 'Message the seller',
  'Новых ответов: {n}': 'New replies: {n}',
  'Вопрос продавцу': 'Question for the seller',
  'В сообщениях': 'In messages',
  'Свернуть чат': 'Collapse chat',
  'Спросите до покупки — ответ придёт сюда и в «Сообщения».':
    'Ask before buying — the reply will appear here and in “Messages”.',
  Сообщение: 'Message',
  'Сообщение продавцу': 'Message to the seller',
  Отправить: 'Send',
  'Телефоны, ники в мессенджерах и ссылки скрываются автоматически.':
    'Phone numbers, messenger handles and links are hidden automatically.',

  // Фото
  'Открыть фото {n} из {total} на весь экран': 'Open photo {n} of {total} full screen',
  'Предыдущее фото': 'Previous photo',
  'Следующее фото': 'Next photo',
  'Фото лота': 'Listing photos',
  'Фото {n}': 'Photo {n}',
  Закрыть: 'Close',

  // Жалоба
  Мошенничество: 'Fraud',
  'Запрещённый товар': 'Prohibited item',
  'Контакты вне площадки': 'Contacts outside the marketplace',
  Оскорбления: 'Insults',
  Другое: 'Other',
  'Выберите причину': 'Choose a reason',
  'Опишите, что не так': 'Describe what’s wrong',
  'Не удалось отправить жалобу. Попробуйте ещё раз.': 'Couldn’t send the report. Try again.',
  'Жалоба отправлена. Решение модератора придёт в уведомления.':
    'Report sent. The moderator’s decision will arrive in your notifications.',
  Пожаловаться: 'Report',
  'Что не так с лотом': 'What’s wrong with the listing',
  'Что не так с пользователем': 'What’s wrong with the user',
  'Подробности для модератора — необязательно': 'Details for the moderator — optional',
  Подробности: 'Details',
  'Отправить жалобу': 'Send report',
  Отмена: 'Cancel',

  // Отзывы
  'до {sum}': 'up to {sum}',
  'Не удалось сохранить ответ.': 'Couldn’t save the reply.',
  Оценка: 'Rating',
  Все: 'All',
  'Отзывов о продавце пока нет.': 'The seller has no reviews yet.',
  изменён: 'edited',
  'Ответ продавца:': 'Seller’s reply:',
  'Ответ увидят все покупатели. Контакты скроются.':
    'All buyers will see the reply. Contacts will be hidden.',
  'Опубликовать ответ': 'Publish reply',
  'Изменить ответ': 'Edit reply',
  Ответить: 'Reply',
  'Показать ещё': 'Show more',
  'Все отзывы о продавце': 'All seller reviews',
  '{n} из 5': '{n} of 5',
  'Фото к отзыву {n} из {total}': 'Review photo {n} of {total}',
  'Фото к отзыву': 'Review photos',
  'Загрузка…': 'Uploading…',
  Фото: 'Photo',
  'До {n} фото — скриншоты товара или игры. Все покупатели их увидят.':
    'Up to {n} photos — screenshots of the item or the game. All buyers will see them.',
  'С фото': 'With photos',
  'Таких отзывов нет.': 'No such reviews.',

  // История цены
  'История цены': 'Price history',
  'Цена не менялась с {date} — {price}.': 'The price hasn’t changed since {date} — {price}.',
  'Цена не менялась последние {n} дней — {price}.':
    'The price hasn’t changed in the last {n} days — {price}.',
  '{price} с {from} по {to}': '{price} from {from} to {to}',
  сегодня: 'today',
  'с {from} по {to}': 'from {from} to {to}',
  'с {from} — сейчас': 'from {from} — now',
  Сейчас: 'Now',
  минимум: 'lowest',
  максимум: 'highest',
  'Все изменения: {n}': 'All changes: {n}',
  Когда: 'When',
  'минимум за {n} дней': '{n}-day low',
  'Цена ниже, чем когда-либо у этого лота за последние {n} дней':
    'Lower than this offer has been at any time in the last {n} days',
};
