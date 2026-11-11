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
  'Например, AK-47 | Красная линия, после полевых': 'For example, AK-47 | Redline, Field-Tested',
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
  'Один товар или услуга за одну цену: предмет, обучение, подписка':
    'One item or service for one price: an item, coaching, a subscription',
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
  'изменения сохранены': 'changes saved',
  'В этом списке его не видно.': 'It isn’t shown in this list.',
  'Показать все лоты': 'Show all listings',
  'Показано {n} из {total}': 'Showing {n} of {total}',
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
  // «Продавать на GameMarket» — калькулятор (часть 109)
  'Продавать на GameMarket': 'Sell on GameMarket',
  'Сколько вы получите с продажи скина, ключа или валюты — комиссия, вывод и сумма на руки до регистрации, рядом со ставками FunPay и Playerok.':
    'How much you get from selling a skin, key or currency — fee, withdrawal and take-home before you sign up, next to FunPay and Playerok rates.',
  'Посчитайте, сколько получите с продажи, — до регистрации. Комиссия берётся только с проданного, выставлять лоты бесплатно.':
    'See how much you’ll get from a sale — before you sign up. The fee is charged only on what sells; listing is free.',
  'Калькулятор сейчас недоступен — попробуйте обновить страницу.': 'The calculator is unavailable right now — try refreshing the page.',
  'Как устроена продажа': 'How selling works',
  'Покупатель платит площадке, деньги ждут в сделке. Выдали товар, покупатель подтвердил — деньги на вашем балансе.':
    'The buyer pays the marketplace and the money waits in the deal. You deliver, the buyer confirms — the money is on your balance.',
  'Не подтвердил и не открыл спор — через {h} ч подтверждение само.':
    'If they neither confirm nor open a dispute, it’s confirmed automatically after {h} h.',
  'Ключи и коды можно выдавать автоматически: загрузите их на склад лота — покупатель получит сразу после оплаты.':
    'Keys and codes can be delivered automatically: upload them to the listing’s stock and the buyer gets them right after paying.',
  'Ручная выдача — в течение {h} ч после оплаты, иначе заказ отменится и деньги вернутся покупателю.':
    'Manual delivery — within {h} h of payment, otherwise the order is cancelled and the buyer is refunded.',
  'Вывод на карту, СБП и ЮMoney — {pct}, в USDT — {usdt}. Комиссия продавца снижается за продажи, рейтинг и проверенные документы.':
    'Withdrawals to a card, SBP and YooMoney — {pct}, to USDT — {usdt}. The seller fee goes down with sales, rating and verified documents.',
  'Не удалось посчитать. Попробуйте ещё раз.': 'Couldn’t calculate. Try again.',
  'Сколько вы получите': 'How much you get',
  'Цена лота, ₽': 'Listing price, ₽',
  'Цена — от 1 до 10 000 000 ₽.': 'Price — from 1 to 10,000,000 ₽.',
  'Цена лота': 'Listing price',
  'Комиссия площадки · {pct}': 'Marketplace fee · {pct}',
  'Вывод на карту или СБП · {pct}, минимум {min}': 'Withdrawal to a card or SBP · {pct}, minimum {min}',
  'Вам на руки': 'You take home',
  'С той же продажи на других площадках': 'The same sale on other marketplaces',
  'в среднем {fee} и вывод 3%, минимум 30 ₽': '{fee} on average and 3% withdrawal, minimum 30 ₽',
  '{fee} и вывод 6%, минимум 60 ₽': '{fee} and 6% withdrawal, minimum 60 ₽',
  'Ставки FunPay и Playerok сверены {date} по их справке и прайсам. У FunPay ставка зависит от раздела: в среднем 9%, во многих разделах от 3%. Наша комиссия снижается за продажи, рейтинг и проверенные документы — до {pp} процентных пунктов.':
    'FunPay and Playerok rates were checked on {date} against their help pages and price lists. FunPay’s rate depends on the category: 9% on average, from 3% in many. Our fee goes down with sales, rating and verified documents — by up to {pp} percentage points.',
  'Выставить первый лот': 'List your first item',
  'Выставить лот': 'List an item',

  // API для продавцов (часть 127)
  'API для продавцов': 'API for sellers',
  'Лоты, наличие, склад автовыдачи, заказы и вебхук «новый заказ» — по ключу, без пароля от аккаунта.': 'Listings, stock, auto-delivery inventory, orders and a “new order” webhook — with a key, without your account password.',
  'Свой бот или склад: цены и наличие, загрузка товара для автовыдачи, заказы и отметка выдачи — по ключу, без пароля от аккаунта.': 'Your own bot or warehouse: prices and stock, uploading goods for auto-delivery, orders and marking delivery — with a key, without your account password.',
  'Ключ': 'Key',
  'Выпустите ключ в': 'Create a key in',
  '«Инструментах»': '“Tools”',
  'и передавайте его в заголовке. Ключ показывается один раз; утёк — отзовите, он перестанет работать сразу. До 5 ключей.': 'and send it in a header. The key is shown once; if it leaks, revoke it and it stops working immediately. Up to 5 keys.',
  'Не больше {n} запросов в минуту на ключ, сверх — ответ 429 и заголовок Retry-After. Каждый запрос — в журнале «Инструментов» 30 дней.': 'No more than {n} requests per minute per key; above that you get 429 and a Retry-After header. Every request stays in the “Tools” log for 30 days.',
  'Лоты': 'Listings',
  'Свои лоты: цена (копейки строкой), наличие, статус, игра и раздел. Дальше — по next.': 'Your listings: price (kopecks as a string), stock, status, game and section. Continue with next.',
  'Поменять цену, наличие или снять и вернуть: {"price": "49000", "stock": 3, "status": "paused"}. Правила те же, что на сайте.': 'Change the price or stock, pause or resume: {"price": "49000", "stock": 3, "status": "paused"}. Same rules as on the site.',
  'Склад автовыдачи: {"items": ["ключ или строка товара", …]}, до {n} за раз. Повторы и уже выданное пропускаются.': 'Auto-delivery stock: {"items": ["key or goods line", …]}, up to {n} at a time. Duplicates and already delivered items are skipped.',
  'Свои продажи: номер, статус, сумма и сколько придёт вам, ник покупателя и его ответы на поля лота.': 'Your sales: number, status, amount and your payout, buyer’s username and their answers to the listing fields.',
  'Отметить выдачу. С {"message": "…"} — сообщение покупателю в чат заказа (контакты скрываются, как в чате).': 'Mark as delivered. With {"message": "…"} — a message to the buyer in the order chat (contacts are hidden, as in chat).',
  'Вебхук «оплачен новый заказ»': '“New paid order” webhook',
  'Задайте адрес (https) в «Инструментах» — получите секрет. На каждый оплаченный заказ придёт POST с JSON и заголовками:': 'Set an https address in “Tools” to get a secret. Each paid order sends a POST with JSON and headers:',
  'Проверяйте подпись: HMAC-SHA256 тела вашим секретом. Ответ не 2xx или тишина 5 секунд — повторим через {delays} мин.': 'Check the signature: HMAC-SHA256 of the body with your secret. A non-2xx answer or 5 seconds of silence — we retry in {delays} min.',
  'Не удалось загрузить настройки API.': 'Couldn’t load API settings.',
  'API': 'API',
  'Свой бот или склад: цены и наличие лотов, загрузка товара для автовыдачи, заказы и отметка выдачи — по ключу, без пароля от аккаунта.': 'Your own bot or warehouse: listing prices and stock, uploading goods for auto-delivery, orders and marking delivery — with a key, without your account password.',
  'Документация': 'Documentation',
  'Скопируйте сейчас: больше мы его не покажем.': 'Copy it now: we won’t show it again.',
  'последний запрос {date}': 'last request {date}',
  'ещё не использовался': 'not used yet',
  'Отозвать ключ «{name}»? Запросы с ним сразу перестанут работать.': 'Revoke the “{name}” key? Requests with it will stop working immediately.',
  'Не удалось отозвать ключ.': 'Couldn’t revoke the key.',
  'Отозвать': 'Revoke',
  'Ключей пока нет.': 'No keys yet.',
  'Новый ключ API:': 'New API key:',
  'Не удалось выпустить ключ.': 'Couldn’t create the key.',
  'Название ключа': 'Key name',
  'Например, бот склада': 'For example, stock bot',
  'Выпустить ключ': 'Create key',
  'Секрет для проверки подписи вебхука:': 'Secret for checking the webhook signature:',
  'Не удалось сохранить вебхук.': 'Couldn’t save the webhook.',
  'Адрес (https)': 'Address (https)',
  'Сменить': 'Change',
  'Проверочное событие отправлено — результат ниже через несколько секунд.': 'Test event sent — the result appears below in a few seconds.',
  'Не удалось отправить проверку.': 'Couldn’t send the test.',
  'Проверить': 'Test',
  'Не удалось убрать вебхук.': 'Couldn’t remove the webhook.',
  'не доставлено': 'not delivered',
  'повтор': 'retrying',
  'Последние запросы': 'Recent requests',
  'Свой бот или склад — через API по ключу, без пароля от аккаунта.': 'Your own bot or warehouse — via the API with a key, without your account password.',
  // Услуги со сроком (часть 125)
  'Срок выполнения': 'Deadline',
  'Без срока — выдам в течение суток': 'No deadline: I deliver within a day',
  'Считается от оплаты. Не успели — покупатель сразу может открыть спор, а без выдачи и спора деньги вернутся ему через сутки после срока.':
    'Counted from payment. Miss it and the buyer can open a dispute right away; with no delivery and no dispute, the money goes back to them a day after the deadline.',
  '«Взять в работу»: покупатель увидит отметку в заказе. У услуг со сроком в заказе есть serviceDueAt — выполнить до.':
    '“Take on”: the buyer sees the mark on the order. Services with a deadline carry serviceDueAt, the time to complete by.',
  // Гарантия продавца (часть 126)
  'Гарантия': 'Warranty',
  'Без гарантии': 'No warranty',
  'Столько дней после подтверждения покупатель может открыть спор, если с товаром что-то не так. Деньги придут вам, когда гарантия закончится. Покупатели выбирают лоты с гарантией охотнее.':
    'For this many days after confirming, the buyer can open a dispute if something is wrong with the goods. You get the money when the warranty ends. Buyers prefer listings with a warranty.',
  // Кому продавать (часть 136)
  'Кому продавать': 'Who to sell to',
  'Отсейте рискованных покупателей. Условия покупатель увидит на странице лота до заказа.': 'Filter out risky buyers. Buyers see the conditions on the listing page before ordering.',
  'Аккаунт покупателя не моложе': 'Buyer account at least',
  'Любой': 'Any age',
  'Проигранных споров за 90 дней — не больше': 'Lost disputes in 90 days — no more than',
  'Не важно': 'Doesn’t matter',
  'Ни одного': 'None',
  'Не продавать тем, кого другие продавцы чаще не рекомендуют': 'Don’t sell to buyers whom other sellers more often don’t recommend',
  'Сохранено.': 'Saved.',
  // Ссылка на обмен Steam (часть 142)
  'Проверим формат ссылки и запомним её у покупателя': 'We’ll check the link format and remember it for the buyer',
  'Ссылку на обмен Steam проверим по формату и подставим покупателю в следующий заказ.':
    'We’ll check the Steam trade link format and prefill it in the buyer’s next order.',
  // Чистая выдача (часть 143)
  'Такой лот у вас уже в продаже:': 'You already have this listing on sale:',
  'В разделе покажем одну карточку — дешёвую, остальные выйдут, когда её купят. Проще добавить наличие в тот лот.':
    'The section shows one card, the cheapest; the others appear once it is bought. It’s simpler to add stock to that listing.',
  // Лот на английском (часть 144)
  'На английском — необязательно': 'In English — optional',
  'Покупатели с английским языком сайта увидят эти название и описание. Пусто — увидят русские.':
    'Buyers using the site in English will see this title and description. Left empty — they see the Russian ones.',
  'Название на английском': 'Title in English',
  'Описание на английском': 'Description in English',
  'Название на английском — от 3 знаков': 'The English title must be at least 3 characters',
  'Название на английском — латиницей': 'Write the English title in Latin letters',
};
