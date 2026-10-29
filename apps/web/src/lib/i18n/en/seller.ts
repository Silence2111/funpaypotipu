/** Продавцу: форма лота, «Мои лоты», склад автовыдачи, продвижение. */
export const SELLER: Record<string, string> = {
  // Форма лота: заголовок и общие ошибки
  'Новый лот': 'New listing',
  'Изменить лот': 'Edit listing',
  'Лот появится в каталоге сразу. Деньги за продажу придут на баланс, когда покупатель подтвердит получение.':
    'The listing appears in the catalog right away. Money from a sale reaches your balance once the buyer confirms receipt.',
  'Изменения видны в каталоге сразу. Уже оформленные заказы идут по прежней цене.':
    'Changes show in the catalog right away. Orders already placed keep the old price.',
  'Изменения не сохранены — поправьте отмеченные поля.':
    'Changes not saved — fix the highlighted fields.',
  'Лот не опубликован — поправьте отмеченные поля.':
    'Listing not published — fix the highlighted fields.',
  'Не удалось сохранить изменения. Попробуйте ещё раз через минуту.':
    'Couldn’t save the changes. Try again in a minute.',
  'Не удалось опубликовать лот. Попробуйте ещё раз через минуту.':
    'Couldn’t publish the listing. Try again in a minute.',
  'Укажите характеристику «{name}»': 'Fill in “{name}”',

  // Игра, раздел, характеристики
  Игра: 'Game',
  'Выберите игру': 'Choose a game',
  'Что продаёте': 'What are you selling',
  'Выберите, что продаёте': 'Choose what you’re selling',
  'Выберите категорию': 'Choose a category',
  'Сначала выберите игру': 'Choose a game first',
  'Игру и раздел у выставленного лота не меняют: к ним привязаны характеристики и заказы.':
    'The game and category of a published listing can’t be changed: its details and orders are tied to them.',
  'Ключи загрузите на склад после публикации: с первым ключом лот появится в каталоге. Покупатель получит ключи сразу после оплаты, можно несколько в одном заказе.':
    'Upload keys to the stock after publishing: the listing appears in the catalog with the first key. The buyer gets keys right after payment, several per order if needed.',
  '{label} — необязательно': '{label} — optional',
  Выберите: 'Choose',
  Да: 'Yes',

  // Название, описание
  Название: 'Title',
  'Название — от 3 знаков: его видят в каталоге':
    'Title must be at least 3 characters: buyers see it in the catalog',
  'Например, Аккаунт CS2, Prime, 800 часов': 'For example, CS2 account, Prime, 800 hours',
  Описание: 'Description',
  'Опишите, что получит покупатель и как передаёте':
    'Describe what the buyer gets and how you deliver it',
  'Что входит, как передаёте, сколько ждать. Чем точнее — тем меньше споров.':
    'What’s included, how you deliver, how long it takes. The more precise, the fewer disputes.',

  // Как продаёте и выдаёте
  'Как продаёте': 'How you sell',
  'Фиксированная цена': 'Fixed price',
  'Один номинал за одну цену, например «3280 кристаллов»':
    'One denomination for one price, for example “3280 crystals”',
  'На сумму покупателя': 'Buyer’s amount',
  'Покупатель вводит сумму, вы задаёте наценку и границы — как пополнение Steam':
    'The buyer enters an amount, you set the markup and limits — like a Steam top-up',
  'Как выдаёте': 'How you deliver',
  Вручную: 'Manually',
  'Передаёте товар в чате заказа и отмечаете выдачу':
    'You hand over the goods in the order chat and mark them delivered',
  'Автоматически со склада': 'Automatically from stock',
  'Загружаете товар строками: логин и пароль, промокод, ссылка. Покупатель получает свою строку сразу после оплаты':
    'You upload goods as lines: login and password, promo code, link. The buyer gets their line right after payment',
  'Склад — внизу,': 'Stock is at the bottom of',
  'на странице лота': 'the listing page',
  'Товар загрузите на склад после сохранения: с первой строкой лот появится в каталоге.':
    'Upload goods to the stock after saving: the listing appears in the catalog with the first line.',
  'Каждая строка — одна штука: покупатель может взять несколько, наличие считает склад.':
    'Each line is one item: a buyer can take several, and the stock counts what’s left.',
  'Строки на складе останутся: включите автовыдачу снова — и они вернутся в продажу.':
    'Lines in stock stay: turn auto-delivery back on and they return to sale.',
  Целиком: 'As a whole',
  'Один товар или услуга за одну цену: аккаунт, буст, предмет':
    'One item or service for one price: account, boost, item',
  Поштучно: 'By quantity',
  'Валюта или одинаковые предметы: цена за пачку, количество выбирает покупатель':
    'Currency or identical items: price per pack, the buyer picks the quantity',

  // Что спросить у покупателя
  'Что спросить у покупателя — необязательно': 'What to ask the buyer — optional',
  'Поле {n}': 'Field {n}',
  'Например, ник в игре': 'For example, in-game name',
  обязательно: 'required',
  'Убрать поле {name}': 'Remove field {name}',
  Убрать: 'Remove',
  'Ник в игре': 'In-game name',
  Сервер: 'Server',
  'ID персонажа': 'Character ID',
  'Своё поле': 'Custom field',
  'Название поля — от 2 символов': 'Field name must be at least 2 characters',
  'Названия полей не должны повторяться': 'Field names must not repeat',
  'Покупатель заполнит это до оплаты, ответы будут в заказе. Пароли и коды не спрашивайте.':
    'The buyer fills this in before paying, and the answers appear in the order. Don’t ask for passwords or codes.',

  // Сообщение после оплаты
  'Сообщение покупателю после оплаты — необязательно':
    'Message to the buyer after payment — optional',
  'Например: активируйте ключ в Steam — «Игры», затем «Активировать в Steam»':
    'For example: activate the key in Steam — “Games”, then “Activate a Product on Steam”',
  'Например: войдите по данным из заказа и сразу смените пароль и почту':
    'For example: sign in with the details from the order and change the password and email right away',
  'Например: спасибо за заказ, передам товар за 15 минут — будьте в сети':
    'For example: thanks for your order, I’ll deliver within 15 minutes — please stay online',
  'Придёт в чат заказа от вашего имени сразу после оплаты. Контакты и ссылки скрываются, как в любом сообщении.':
    'Sent to the order chat in your name right after payment. Contacts and links are hidden, as in any message.',

  // Поштучно
  'В этом разделе продают количеством: цена — за {qty}, одинаково у всех продавцов, чтобы покупатель сравнивал цены.':
    'This category sells by quantity: the price is per {qty}, the same for every seller, so buyers can compare prices.',
  Единица: 'Unit',
  'ед.': 'units',
  золота: 'gold',
  'Цена за': 'Price per',
  'В наличии': 'In stock',
  'Минимум за заказ': 'Minimum per order',
  'Единицу пишите так, как она стоит после числа: 1 000 золота, 5 шт.':
    'Write the unit as it reads after a number: 1,000 gold, 5 pcs.',
  'Наличие уменьшается с каждой оплатой; на нуле лот уходит из каталога.':
    'Stock goes down with every payment; at zero the listing leaves the catalog.',

  // Цена и пополнение на сумму покупателя
  'Наценка, %': 'Markup, %',
  'От, ₽': 'From, ₽',
  'До, ₽': 'To, ₽',
  'Укажите наценку и границы суммы целыми рублями':
    'Enter the markup and the amount limits in whole rubles',
  'Покупатель вводит сумму в этих границах и платит её плюс вашу наценку.':
    'The buyer enters an amount within these limits and pays it plus your markup.',
  'Цена, ₽': 'Price, ₽',
  'С такими же параметрами сейчас {offers}: от {min}, чаще всего {range}.':
    'With the same parameters there are {offers} now: from {min}, mostly {range}.',
  'В разделе сейчас {offers}: от {min}, чаще всего {range}.':
    'This category has {offers} now: from {min}, mostly {range}.',
  'Ваша цена — среди самых низких.': 'Your price is among the lowest.',
  'Ваша цена — в обычном разбросе.': 'Your price is in the usual range.',
  'Ваша цена выше, чем у большинства.': 'Your price is higher than most.',
  'Цена за {qty}, ₽': 'Price per {qty}, ₽',
  'Цена в рублях, например 490': 'Price in rubles, for example 490',
  'Покупатель пополняет {nominal} и платит {price} с наценкой {markup}':
    'The buyer tops up {nominal} and pays {price} with a {markup} markup',
  'Комиссия площадки': 'Marketplace fee',
  'Вы получите': 'You’ll get',
  'Вы получите за {qty}': 'You’ll get per {qty}',
  'Ваш уровень: {level}': 'Your level: {level}',
  'Укажите категорию и цену — покажем комиссию и сумму, которую вы получите.':
    'Enter a category and price — we’ll show the fee and the amount you’ll get.',

  // Фото
  'Фото — необязательно': 'Photos — optional',
  'До {n} фото. Первое — обложка в разделе и на странице лота.':
    'Up to {n} photos. The first one is the cover in the category and on the listing page.',
  Обложка: 'Cover',
  'Сделать обложкой': 'Make cover',
  'Убрать фото': 'Remove photo',
  'Ещё фото': 'More photos',
  'Добавить фото': 'Add photos',
  'Загружаем…': 'Uploading…',
  'Загружаем {progress}…': 'Uploading {progress}…',
  '{i} из {n}': '{i} of {n}',
  'Фото не загрузилось. Попробуйте другое.': 'The photo didn’t upload. Try another one.',
  'Фото не загрузилось. Проверьте связь и попробуйте ещё раз.':
    'The photo didn’t upload. Check your connection and try again.',

  // Отправка
  'Сохраняем…': 'Saving…',
  'Публикуем…': 'Publishing…',
  'Сохранить изменения': 'Save changes',
  'Опубликовать лот': 'Publish listing',

  // Изменение лота
  'Лот не найден или он не ваш.': 'Listing not found, or it isn’t yours.',
  'Лот заблокирован модератором — изменить его нельзя. Если это ошибка, напишите в поддержку.':
    'The listing was blocked by a moderator and can’t be edited. If this is a mistake, contact support.',
  'К моим лотам': 'Back to my listings',
  'Загружаем лот': 'Loading listing',

  // Мои лоты
  'Продать лот': 'Add listing',
  'Изменения сохранены.': 'Changes saved.',
  'Изменения сохранены: «{title}».': 'Changes saved: “{title}”.',
  'В этом списке его не видно.': 'It isn’t shown in this list.',
  'Показать все лоты': 'Show all listings',
  Все: 'All',
  'В продаже': 'On sale',
  Сняты: 'Paused',
  Закончились: 'Sold out',
  Заблокированы: 'Blocked',
  'Какие лоты показать': 'Which listings to show',
  'Найти лот': 'Find a listing',
  'Найти лот по названию': 'Find a listing by title',
  'Загружаем лоты': 'Loading listings',
  'Лотов пока нет. Выставить первый — пара минут.':
    'No listings yet. Publishing your first takes a couple of minutes.',
  'Создать лот': 'Create listing',
  'Ничего не нашлось.': 'Nothing found.',
  'Выбрать все: {name}': 'Select all: {name}',
  'Поднять все': 'Raise all',
  'Раздел на витрине': 'Category in the catalog',
  Раздел: 'Category',
  'Не получилось. Попробуйте ещё раз.': 'That didn’t work. Try again.',

  // Отпуск
  'В отпуск': 'Go on vacation',
  'Снять все лоты разом и вернуть их одной кнопкой':
    'Pause all listings at once and bring them back with one button',
  'Снять с продажи все лоты в продаже ({n})? Вернуть их можно одной кнопкой. Открытые заказы отпуск не отменяет — их нужно довести.':
    'Pause all listings on sale ({n})? You can bring them back with one button. Vacation doesn’t cancel open orders — you still need to complete them.',
  'Вы в отпуске: сняли с продажи {n}.': 'You’re on vacation: {n} paused.',
  'С возвращением: вернули в продажу {n}.': 'Welcome back: {n} returned to sale.',
  'Вы в отпуске с {date}': 'On vacation since {date}',
  'Снятые на время отпуска лоты ({n}) вернутся в продажу одной кнопкой. В профиле покупатели видят пометку «в отпуске».':
    'Listings paused for vacation ({n}) return to sale with one button. Buyers see “on vacation” on your profile.',
  'Вернуться к продажам': 'Back to selling',

  // Действия с несколькими лотами
  'Действия с выбранными лотами': 'Actions on selected listings',
  'Выбрано {n}': '{n} selected',
  'Вернуть в продажу': 'Return to sale',
  'Снять с продажи': 'Pause',
  Поднять: 'Raise',
  'Снять выбор': 'Clear selection',
  'Подняли: {n}': 'Raised: {n}',
  'остальные — через {n} мин': 'the rest in {n} min',
  'не в продаже: {n}': 'not on sale: {n}',
  'Сняли с продажи: {n}.': 'Paused: {n}.',
  'Пропустили {n} — уже сняты или закончились.': 'Skipped {n} — already paused or sold out.',
  'Вернули в продажу: {n}.': 'Returned to sale: {n}.',
  'Пропустили {n} — уже в продаже, без наличия или заблокированы.':
    'Skipped {n} — already on sale, out of stock or blocked.',
  'поднято: {n}': 'raised: {n}',
  'нечего поднимать': 'nothing to raise',
  'не удалось поднять': 'couldn’t raise',

  // Строка лота
  'Выбрать «{title}»': 'Select “{title}”',
  закончился: 'sold out',
  'заблокирован модератором': 'blocked by a moderator',
  'снят на время отпуска': 'paused for vacation',
  'в наличии {qty}': '{qty} in stock',
  'в топе до {time}': 'in the top until {time}',
  'продвижение до {date}': 'promoted until {date}',
  'В поддержку': 'Contact support',
  'Пополнить склад': 'Restock',
  Пополнить: 'Restock',
  '«{title}» в продаже': '“{title}” on sale',
  'Не удалось изменить статус лота.': 'Couldn’t change the listing status.',
  'Продлить продвижение': 'Extend promotion',
  Продвинуть: 'Promote',
  Изменить: 'Edit',
  'Изменить «{title}»': 'Edit “{title}”',
  Удалить: 'Delete',
  'Удалить «{title}»': 'Delete “{title}”',
  'Удалить «{title}»? Если по лоту были заказы, он уйдёт в архив — история сделок сохранится.':
    'Delete “{title}”? If the listing had orders, it goes to the archive and the deal history is kept.',
  'Не удалось удалить лот.': 'Couldn’t delete the listing.',
  'Цена не сохранилась.': 'The price wasn’t saved.',
  'Цена следует из наценки — меняется в форме лота':
    'The price follows from the markup — change it in the listing form',
  'Цена {price} — изменить': 'Price {price} — edit',
  'Новая цена': 'New price',
  'Новая цена {pack}': 'New price {pack}',
  'Цена — число больше нуля': 'Price must be a number above zero',

  // Поднять в топ
  'Поднять лот в топ': 'Raise the listing to the top',
  'в топе': 'in the top',
  поднято: 'raised',
  нельзя: 'not available',

  // Продвижение
  сутки: '1 day',
  '{n} суток': '{n} days',
  'Не удалось продвинуть лот.': 'Couldn’t promote the listing.',
  'В продвижении до {date}. Продление добавится к сроку.':
    'Promoted until {date}. An extension adds to the remaining time.',
  'Лот будет выше в своём разделе каталога.':
    'The listing will rank higher in its catalog category.',
  Отмена: 'Cancel',
  'Оплата с баланса.': 'Paid from your balance.',
  'Оплата с баланса · на балансе {sum}.': 'Paid from your balance · {sum} available.',
  'Покупатели видят пометку «продвижение».': 'Buyers see a “promoted” label.',

  // Склад автовыдачи
  'Склад ключей': 'Key stock',
  'Склад автовыдачи': 'Auto-delivery stock',
  'Видите только вы. Каждая строка — одна штука: покупатель получает свою сразу после оплаты.':
    'Only you can see this. Each line is one item: the buyer gets theirs right after payment.',
  'в наличии: {n}': 'in stock: {n}',
  'зарезервировано: {n}': 'reserved: {n}',
  'выдано: {n}': 'delivered: {n}',
  'Ключи, по одному в строке': 'Keys, one per line',
  'Товар, по одной штуке в строке': 'Goods, one item per line',
  'Ключи по одному в строке:': 'Keys, one per line:',
  'По одной штуке в строке:': 'One item per line:',
  'логин:пароль': 'login:password',
  'промокод или ссылка': 'promo code or link',
  'Повторы не ложатся на склад: одна строка — одному покупателю.':
    'Duplicates aren’t added to the stock: one line goes to one buyer.',
  'На склад добавлено: {n}.': 'Added to stock: {n}.',
  'Повторы пропущены: {n}.': 'Duplicates skipped: {n}.',
  'Не удалось загрузить. Попробуйте ещё раз.': 'Couldn’t upload. Try again.',
  Загрузить: 'Upload',
  'Загрузить {n}': 'Upload {n}',
};
