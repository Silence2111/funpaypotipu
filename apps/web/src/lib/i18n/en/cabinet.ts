/** Кабинет: кошелёк, вывод, история, покупки и продажи, избранное, поддержка. */
export const CABINET: Record<string, string> = {
  // Обзор
  Кабинет: 'Account',
  'Загружаем кабинет': 'Loading your account',
  'Разделы кабинета': 'Account sections',
  Обзор: 'Overview',
  Заказы: 'Orders',
  Консоль: 'Console',
  'Мои заказы': 'My orders',
  'Все покупки и продажи →': 'All purchases and sales →',
  'Номер заказа, лот или ник': 'Order number, listing or username',
  'Поиск по заказам': 'Search orders',
  Период: 'Period',
  'За всё время': 'All time',
  '7 дней': '7 days',
  '3 месяца': '3 months',
  Год: 'Year',
  'Ничего не нашлось. Проверьте номер заказа, название лота или ник.':
    'Nothing found. Check the order number, listing title or username.',
  'Сбросить поиск': 'Clear search',
  'Не удалось загрузить заказы.': 'Couldn’t load your orders.',
  'Заказов пока нет. Оплата хранится у площадки, пока вы не подтвердите получение.':
    'No orders yet. The marketplace holds your payment until you confirm receipt.',
  'Все лоты ({n}) →': 'All listings ({n}) →',
  'Управлять лотами →': 'Manage listings →',
  'в продаже': 'on sale',
  черновик: 'draft',
  снят: 'paused',
  распродан: 'sold out',
  заблокирован: 'blocked',
  'Выйти из аккаунта': 'Sign out of your account',

  // Кошелёк
  Баланс: 'Balance',
  'Баланс, пополнение и вывод, все операции по деньгам. С баланса можно оплатить покупку или продвижение лота.':
    'Balance, top-ups and withdrawals, every money transaction. You can pay for purchases or listing promotion from your balance.',
  Доступно: 'Available',
  'В сделках': 'In deals',
  '{n} — зачислим, когда покупатели подтвердят получение':
    '{n} — credited once buyers confirm receipt',
  'На выводе': 'Being withdrawn',
  '{n} — уже не на балансе': '{n} — already off your balance',
  Пополнение: 'Top-up',
  'Пополнить, вывести, выписка →': 'Top up, withdraw, statement →',
  'Первый вывод до первой продажи отправим не раньше {date}.':
    'A first withdrawal before your first sale is sent no earlier than {date}.',
  'Платёжная система не провела выплату — проверьте реквизиты или выберите другой способ.':
    'The payment system didn’t complete the payout — check the details or choose another method.',
  'Показать все ({n})': 'Show all ({n})',
  Свернуть: 'Show less',
  'На демо-стенде пополнение проходит без списания денег.':
    'On the demo site, top-ups don’t charge any real money.',
  'Вывод средств': 'Withdrawal',

  // Вывод
  'Способ вывода': 'Withdrawal method',
  'Сумма вывода, ₽': 'Withdrawal amount, ₽',
  'Сумма, ₽': 'Amount, ₽',
  'Куда вывести': 'Withdraw to',
  'Номер карты или телефон СБП': 'Card number or SBP phone',
  Вывести: 'Withdraw',
  'Укажите сумму и реквизиты': 'Enter the amount and payout details',
  'Минимум для «{method}» — {sum}': 'The minimum for “{method}” is {sum}',
  'Заявка на вывод создана': 'Withdrawal request created',
  'Не удалось создать заявку': 'Couldn’t create the request',
  'Комиссия {sum}': 'Fee {sum}',
  'на руки {sum}': 'you receive {sum}',
  'Больше {sum} за раз — после проверки личности.': 'Over {sum} at a time — after ID verification.',

  // Аналитика продавца
  'Аналитика продавца': 'Seller analytics',
  'Выручка всего': 'Total revenue',
  'Выручка за 30 дней': 'Revenue, last 30 days',
  'Продаж всего': 'Total sales',
  'В работе': 'In progress',
  'Активных лотов': 'Active listings',
  'Выручка по дням (14 дней)': 'Daily revenue (14 days)',

  // Покупки и продажи
  'Покупки или продажи': 'Purchases or sales',
  Статус: 'Status',
  Споры: 'Disputes',
  Завершены: 'Completed',
  'Возвраты и отмены': 'Refunds and cancellations',
  'Ждут оплаты': 'Awaiting payment',
  'Загружаем заказы': 'Loading orders',
  'Покупок пока нет. Деньги будут у площадки, пока вы не подтвердите получение.':
    'No purchases yet. The marketplace holds the money until you confirm receipt.',
  'Продаж пока нет. Лот с понятным описанием и честной ценой продаётся быстрее.':
    'No sales yet. A listing with a clear description and a fair price sells faster.',
  'Заказов с таким статусом нет.': 'No orders with this status.',
  Сумма: 'Amount',
  'продавец {name}': 'seller {name}',
  'покупатель {name}': 'buyer {name}',
  'нужно выдать': 'to deliver',
  'подтвердите получение': 'confirm receipt',

  // Избранное

  // Поддержка
  'Новое обращение': 'New request',
  'О чём вопрос': 'Topic',
  'Выберите, о чём вопрос': 'Choose what your question is about',
  'Оплата и баланс': 'Payment and balance',
  'Аккаунт и вход': 'Account and sign-in',
  'Продажи и лоты': 'Sales and listings',
  'Заказ — необязательно': 'Order — optional',
  'Без заказа': 'No order',
  'Заказ со страницы заказа': 'Order from the order page',
  Тема: 'Subject',
  'Коротко: что случилось': 'In short: what happened',
  'Что делали, что ожидали, что получилось. Пароли и коды из СМС не присылайте.':
    'What you did, what you expected, what happened. Don’t send passwords or SMS codes.',
  'Спор по сделке быстрее решит арбитр — откройте его на странице заказа.':
    'An arbiter will resolve a deal dispute faster — open one on the order page.',
  'Не удалось отправить обращение.': 'Couldn’t send the request.',
  'Обращений пока нет. Ответ обычно приходит в течение дня.':
    'No requests yet. Replies usually arrive within a day.',
  закрыто: 'closed',
  'ждём пользователя': 'waiting for the user',
  'есть ответ': 'answered',
  'ждёт ответа': 'awaiting reply',
  'на рассмотрении': 'under review',
  'Обращение не найдено': 'Request not found',
  'Войдите, чтобы открыть обращение.': 'Sign in to open the request.',
  'Очередь поддержки': 'Support queue',
  'Все обращения': 'All requests',
  заказ: 'order',
  'от {name}': 'from {name}',
  'от пользователя': 'from a user',
  Пользователь: 'User',
  'Сообщение…': 'Message…',
  'Обращение закрыто — сообщение откроет его снова':
    'The request is closed — a new message will reopen it',
  'Сообщение не отправлено.': 'Message not sent.',
  'Не удалось закрыть обращение.': 'Couldn’t close the request.',
  'Закрыть обращение': 'Close request',
  'Вопрос решён': 'Issue resolved',
  'Пополнение зачислится, как только банк подтвердит оплату, — обычно за несколько секунд.':
    'The top-up will be credited as soon as the bank confirms the payment — usually within a few seconds.',
  'Телефон, +7 900 000-00-00': 'Phone, +7 900 000-00-00',
  'Номер карты': 'Card number',
  'Номер кошелька ЮMoney': 'YooMoney wallet number',
  'Адрес кошелька USDT (TRC20)': 'USDT wallet address (TRC20)',
  отправляется: 'being sent',
  выплачено: 'paid out',
  'отклонена, деньги на балансе': 'rejected, money back on balance',
  'Выберите банк для перевода по СБП': 'Choose a bank for the SBP transfer',
  'Банк для СБП': 'Bank for SBP',
  'Банк получателя': 'Recipient’s bank',
  'Деньги придут автоматически через ЮKassa после проверки заявки.':
    'The money will arrive automatically via YooKassa once the request is checked.',
  'Заявки на вывод': 'Withdrawal requests',
  'Другие реквизиты': 'Other details',
  'Сохранённые реквизиты': 'Saved payout details',
  // Избранное
  'В продаже': 'On sale',
  Подешевели: 'Cheaper now',
  Закончились: 'Sold out',
  'Недавно добавленные': 'Recently added',
  'Сначала дешевле': 'Cheapest first',
  'Сначала дороже': 'Most expensive first',
  'Сильнее подешевели': 'Biggest price drop',
  'Не удалось загрузить избранное.': 'Couldn’t load your favorites.',
  'Не удалось убрать из избранного.': 'Couldn’t remove it from favorites.',
  'В избранном пока пусто. «В избранное» на странице лота — и за его ценой можно следить.':
    'Your favorites are empty. Tap “Add to favorites” on a listing page to track its price.',
  Показать: 'Show',
  Игра: 'Game',
  'Все игры': 'All games',
  Порядок: 'Order',
  'Под этот фильтр ничего не подходит.': 'Nothing matches this filter.',
  'Показать всё': 'Show all',
  'Убрать из избранного: {title}': 'Remove from favorites: {title}',
  'Убрать из избранного': 'Remove from favorites',
  'Запомнить реквизиты для следующих выводов': 'Remember these details for next withdrawals',
  'Удалить реквизиты {hint}': 'Delete payout details {hint}',
  'Не удалось удалить реквизиты': 'Couldn’t delete the payout details',
  'Укажите карту в форме ЮKassa': 'Enter the card in the YooKassa form',
  'Карта не подошла. Проверьте номер или возьмите другую карту.':
    'This card didn’t work. Check the number or use another card.',
  'Другая карта': 'Another card',
  'Форма ЮKassa не загрузилась.': 'The YooKassa form didn’t load.',
  'Попробовать снова': 'Try again',
  'Номер карты принимает ЮKassa — площадка его не видит и не хранит.':
    'YooKassa takes the card number — the marketplace never sees or stores it.',
  '{m} мин': '{m} min',
  '{h} ч {m} мин': '{h} h {m} min',
  '{h} ч': '{h} h',
  'Не удалось загрузить настройки.': 'Couldn’t load the settings.',
  'Автоподнятие выключено.': 'Auto-raise is off.',
  'Автоподнятие включено.': 'Auto-raise is on.',
  'Не удалось сохранить.': 'Couldn’t save.',
  'Приветствие сохранено.': 'Greeting saved.',
  'Приветствие выключено.': 'Greeting turned off.',
  'Заготовка изменена.': 'Template updated.',
  'Заготовка добавлена.': 'Template added.',
  'Не удалось сохранить заготовку.': 'Couldn’t save the template.',
  'Заготовка удалена.': 'Template deleted.',
  'Не удалось удалить заготовку.': 'Couldn’t delete the template.',
  'Автоподнятие, приветствие, заготовки ответов, автоответы на команды и промокоды — без сторонних ботов с доступом к аккаунту.':
    'Auto-raise, a greeting, reply templates, command auto-replies and promo codes — no third-party bots with access to your account.',
  'Команда для автоответа': 'Command for the auto-reply',
  'Команда, например !оплата': 'Command, for example !payment',
  'Команда — по желанию: покупатель пишет её отдельным сообщением, и заготовка уходит сама, с пометкой «автоответ». Регистр не важен.':
    'The command is optional: when a buyer sends it as a message on its own, the template goes out by itself, marked “auto-reply”. Case doesn’t matter.',
  Автоподнятие: 'Auto-raise',
  'Поднимать лоты автоматически': 'Raise listings automatically',
  Включено: 'On',
  Выключено: 'Off',
  'Лоты поднимаются сами, как только проходит пауза между поднятиями. У вас она {h} ч — с ростом продаж короче.':
    'Listings are raised on their own as soon as the pause between raises is over. Yours is {h} h, and it gets shorter as your sales grow.',
  'Активных лотов нет — поднимать нечего.': 'No active listings, so there’s nothing to raise.',
  'Следующее поднятие — через {time}.': 'Next raise in {time}.',
  'Лоты поднимутся в ближайшие минуты.': 'Your listings will be raised within minutes.',
  Приветствие: 'Greeting',
  'Уходит покупателю на первое сообщение в новом диалоге до покупки — с пометкой «автоответ». Контакты скрываются, как в чате.':
    'Sent to a buyer in reply to their first message in a new pre-purchase chat, marked as an auto-reply. Contacts are hidden, as in chat.',
  'Текст приветствия': 'Greeting text',
  'Здравствуйте. Отвечаю в течение часа, товар в наличии.':
    'Hello. I reply within an hour, and the item is in stock.',
  'Открываются кнопкой в поле сообщения и вставляются в него. {token} заменится на ник собеседника.':
    'They open from a button in the message field and go into it. {token} becomes the other person’s username.',
  'Название заготовки': 'Template name',
  'Название, например «После оплаты»': 'A name, for example “After payment”',
  'Текст заготовки': 'Template text',
  '{token}, спасибо за покупку. Данные для входа — выше в чате.':
    '{token}, thanks for your purchase. The login details are above in the chat.',
  'Сохранить заготовку': 'Save template',
  'Добавить заготовку': 'Add template',
  'Выписка по балансу': 'Balance statement',
  '30 дней': '30 days',
  'Этот месяц': 'This month',
  'Прошлый месяц': 'Last month',
  'Этот год': 'This year',
  'Не удалось загрузить выписку.': 'Couldn’t load the statement.',
  'Файл не скачался. Попробуйте ещё раз.': 'The file didn’t download. Try again.',
  'Период выписки': 'Statement period',
  'На начало': 'Opening',
  Поступило: 'In',
  Списано: 'Out',
  'На конец': 'Closing',
  'Продаж за период: {n} на {gross}, вам зачислено {payout}.':
    'Sales in this period: {n} for {gross}, {payout} credited to you.',
  'Выписка для Excel': 'Statement for Excel',
  'Продажи для Excel': 'Sales for Excel',
  'Даты — по московскому времени, как и период выписки.': 'Dates are in Moscow time, like the statement period.',
  'За этот период операций нет.': 'No transactions in this period.',
  'Таких операций за период нет.': 'No transactions of this type in this period.',
  'Свой период': 'Custom period',
  'Тип операций': 'Transaction type',
  'Все операции': 'All transactions',
  с: 'from',
  по: 'to',
  'Начало периода': 'Start date',
  'Конец периода': 'End date',
  'Укажите обе даты — начало не позже конца.': 'Enter both dates — the start can’t be after the end.',
  '{kind} за период: поступило {credits}, списано {debits}.':
    '{kind} for the period: {credits} in, {debits} out.',
  '{kind} за период: поступило {sum}.': '{kind} for the period: {sum} in.',
  '{kind} за период: списано {sum}.': '{kind} for the period: {sum} out.',

  // Мои поиски
  'Не удалось загрузить поиски.': 'Couldn’t load your searches.',
  'Поиск удалён.': 'Search deleted.',
  'Не удалось удалить поиск.': 'Couldn’t delete the search.',
  'Условия, сохранённые в разделах. Когда выставят подходящий лот, придёт уведомление — о каждом лоте один раз.':
    'Filters you saved in categories. When a matching listing goes up, you get a notification — once per listing.',
  'Сохранённых поисков нет. Откройте раздел игры, выберите фильтры и нажмите «Сохранить поиск» — новые предложения придут уведомлением.':
    'No saved searches yet. Open a game category, pick filters and tap “Save search” — new offers will come as notifications.',
  'Последний новый лот — {date}': 'Latest new listing — {date}',
  'Уведомления включены': 'Notifications on',
  'Без уведомлений': 'No notifications',
  Открыть: 'Open',

  // Избранное: снижение цены
  'Лот подешевеет хотя бы на {pct}% — придёт уведомление. Настройка — в группе «Поиски, избранное и подписки».':
    'If a listing gets at least {pct}% cheaper, you get a notification. Set it up under “Searches, favorites and follows”.',
  'было {price}': 'was {price}',

  // Статистика лотов
  Статистика: 'Stats',

  // Сводка «Сегодня»
  'Выдать товар': 'Deliver the goods',
  'Непрочитанные сообщения': 'Unread messages',
  'Ждут подтверждения покупателя': 'Waiting for the buyer to confirm',
  'Лоты закончились': 'Listings sold out',
  'Скидки кончаются сегодня': 'Discounts ending today',
  'вчера {n}': 'yesterday {n}',
  'Просмотры лотов': 'Listing views',
  'Что ждёт вас': 'Waiting for you',
  'Ничего не ждёт: заказы выданы, споров и новых сообщений нет.':
    'Nothing is waiting: orders are delivered, no disputes or new messages.',

  // Загрузка из таблицы
  'Из таблицы': 'From a table',
  'Загрузить из таблицы': 'Upload from a table',
  'Не удалось загрузить игры.': 'Couldn’t load the games.',
  'Много лотов разом: строка таблицы — лот. Подойдёт CSV из Excel или Google Таблиц или строки, скопированные прямо из таблицы. Один раздел за раз, до {n} лотов; ключи, пополнения и валюта — по одному, через форму лота.':
    'Many listings at once: one table row is one listing. A CSV from Excel or Google Sheets works, or rows copied straight from the table. One category at a time, up to {n} listings; keys, top-ups and currency go one by one through the listing form.',
  '1. Раздел': '1. Category',
  '{category} — по одному': '{category} — one by one',
  'Столбцы: {columns}. Обязательные — со звёздочкой, порядок любой.':
    'Columns: {columns}. Required ones have an asterisk; any order.',
  'Допустимые значения': 'Allowed values',
  'да или нет': 'yes or no',
  'Скачать шаблон': 'Download template',
  '2. Таблица': '2. Table',
  'Выбрать файл CSV': 'Choose a CSV file',
  '…или вставьте строки таблицы вместе с заголовками': '…or paste the table rows with the header row',
  'Строки таблицы': 'Table rows',
  'Готово к выставлению: {ok}': 'Ready to list: {ok}',
  'с ошибками: {n}': 'with errors: {n}',
  Строка: 'Row',
  'И ещё {n} строк без ошибок.': 'And {n} more rows without errors.',
  'Выставить {lots}': 'List {lots}',
  'Строки с ошибками пропустим — исправьте их и загрузите отдельно.':
    'Rows with errors will be skipped — fix them and upload them separately.',
  'Выставлено: {n}': 'Listed: {n}',
  'Строка {line}: {message}': 'Row {line}: {message}',
  'В этом разделе нет ваших лотов, которые правятся таблицей.':
    'You have no listings in this category that can be edited with a table.',
  'Выгрузить мои лоты': 'Export my listings',
  'В выгрузке — столбец ID: поправьте цены, описания, наличие и загрузите таблицу обратно. Строка с ID меняет лот, без ID — выставляет новый; пустая ячейка у лота с ID — «оставить как есть».':
    'The export has an ID column: edit prices, descriptions and stock, then upload the table back. A row with an ID changes that listing, a row without one adds a new listing; an empty cell on a row with an ID means “leave as is”.',
  'Новых: {n} · изменить: {m}': 'New: {n} · to change: {m}',
  'Что будет': 'What happens',
  изменить: 'change',
  новый: 'new',
  'Сохранить: {lots}': 'Save: {lots}',
  'Выставлено: {n} · изменено: {m} · без изменений: {k}': 'Listed: {n} · changed: {m} · unchanged: {k}',
  'снят с продажи': 'off sale',
  '{day}: просмотров {views}, покупок {purchases}': '{day}: {views} views, {purchases} purchases',
  'Просмотров: {n}': 'Views: {n}',
  'Покупок: {n}': 'Purchases: {n}',
  'Статистика не загрузилась.': 'Couldn’t load the stats.',
  Просмотры: 'Views',
  Конверсия: 'Conversion',
  Заработано: 'Earned',
  'Статистика лотов': 'Listing stats',
  'Сколько раз открывали ваши лоты, добавляли в избранное и покупали. Просмотр считается раз в сутки с одного браузера, ваши собственные — нет.':
    'How often your listings were opened, added to favorites and bought. A view counts once a day per browser; your own views don’t count.',
  '{n} дней': '{n} days',
  'Покупки — заказы, оплаченные за эти дни; заработано — по сделкам, завершённым за эти дни, после комиссии. В избранном — сейчас.':
    'Purchases are orders paid in these days; earned is from deals completed in these days, after the fee. Favorites are as of now.',
  'Просмотры: {title}': 'Views: {title}',
  'Просмотры по дням': 'Views by day',
  'Все лоты': 'All listings',
  'За эти дни просмотров не было.': 'No views in these days.',
  'По дням таблицей': 'By day as a table',
  День: 'Day',
  'Лотов пока нет — статистика появится после первого.':
    'No listings yet — stats will appear after your first one.',
  Лот: 'Listing',
  'Показать график этого лота': 'Show this listing’s chart',
  'всего просмотров: {n}': 'all-time views: {n}',

  // Скидка на лот
  'скидка до {date}': 'discount until {date}',
  'Скидка идёт — завершить': 'Discount running — end it',
  Скидка: 'Discount',
  'Идёт скидка — цена вернётся по окончании срока':
    'A discount is running — the price returns when it ends',
  'до {date}': 'until {date}',
  'Скидка −{pct}% до {date}: было {was}, сейчас {now}.':
    'Discount −{pct}% until {date}: was {was}, now {now}.',
  'Не удалось завершить скидку.': 'Couldn’t end the discount.',
  'Завершить скидку': 'End discount',
  'Не удалось начать скидку.': 'Couldn’t start the discount.',
  'Скидка, %': 'Discount, %',
  Срок: 'Period',
  'Станет {now} вместо {was} до {date}.': 'It will be {now} instead of {was} until {date}.',
  'Скидка — от {min} до {max}%.': 'The discount must be from {min} to {max}%.',
  'Начать скидку': 'Start discount',
  'Покупатели увидят зачёркнутую цену и «−{pct}%». У кого лот в избранном, придёт уведомление. По окончании срока цена вернётся сама.':
    'Buyers will see the crossed-out price and “−{pct}%”. Those who have the listing in favorites get a notification. When the period ends, the price returns by itself.',

  // Промокоды продавца
  'Промокод продавца {code}: −{sum}': 'Seller’s promo code {code}: −{sum}',
  'Промокод не подошёл.': 'The promo code didn’t work.',
  Применить: 'Apply',
  'Скидка продавца {pct}% — уже в цене.': 'Seller’s discount {pct}% — already in the price.',
  'Промокод площадки: скидка учтётся в сумме заказа.':
    'Marketplace promo code: the discount will be applied to the order total.',
  'без срока': 'no end date',
  'Промокод создан.': 'Promo code created.',
  'Не удалось создать промокод.': 'Couldn’t create the promo code.',
  'Промокод выключен.': 'Promo code turned off.',
  'Промокод включён.': 'Promo code turned on.',
  'Промокод удалён.': 'Promo code deleted.',
  'Не удалось удалить промокод.': 'Couldn’t delete the promo code.',
  Промокоды: 'Promo codes',
  'Свой код со скидкой за ваш счёт: цена снижается до расчёта комиссии. Покупатель вводит его при оплате; один покупатель — один раз.':
    'Your own discount code at your expense: the price is reduced before the fee is calculated. A buyer enters it at checkout; once per buyer.',
  постоянным: 'repeat buyers',
  'срок вышел': 'expired',
  выключен: 'off',
  'использований: {used} из {max}': 'uses: {used} of {max}',
  'использований: {used}': 'uses: {used}',
  'Промокод {code} включён': 'Promo code {code} is on',
  'Удалить промокод {code}': 'Delete promo code {code}',
  Код: 'Code',
  'Например SUMMER10': 'e.g. SUMMER10',
  'Сколько раз можно использовать': 'How many times it can be used',
  'Сколько раз — без лимита': 'Max uses — unlimited',
  'Только тем, кто уже покупал у вас': 'Only for those who have bought from you',
  'Скидка — от {min} до {max}%. Не действует на пополнения.':
    'The discount is from {min} to {max}%. It doesn’t apply to top-ups.',
  'Создать промокод': 'Create promo code',

  // Подписки на продавцов
  Подписки: 'Following',
  'Подписки на продавцов': 'Sellers you follow',
  'Не удалось загрузить подписки.': 'Couldn’t load your follows.',
  'Вы отписались от {name}.': 'You unfollowed {name}.',
  'Новые лоты и скидки продавцов, на которых вы подписаны. Они же приходят уведомлением — на сайте, в Telegram и пушем, как настроено в группе «Поиски, избранное и подписки».':
    'New listings and discounts from sellers you follow. They also come as notifications — on the site, in Telegram and as push, as set in the “Searches, favorites and follows” group.',
  'Подписок пока нет. Нажмите «Подписаться» в профиле продавца или в его карточке на странице лота — его новые лоты и скидки придут уведомлением.':
    'You don’t follow anyone yet. Tap “Follow” on a seller’s profile or in their card on a listing page — their new listings and discounts will come as notifications.',
  'нет предложений': 'no offers',
  'со скидкой: {n}': 'on sale: {n}',
  'Уведомлять о новых лотах и скидках {name}':
    'Notify me about new listings and discounts from {name}',
  Отписаться: 'Unfollow',
  'Новые лоты и скидки продавца приходят уведомлением. Нажмите, чтобы отписаться.':
    'The seller’s new listings and discounts come as notifications. Tap to unfollow.',
  'Новые лоты и скидки продавца будут приходить уведомлением':
    'The seller’s new listings and discounts will come as notifications',
  'Вы подписаны': 'Following',
  Подписаться: 'Follow',

  // Скидка за количество
  'Скидка за количество': 'Quantity discount',
  'Скидка за количество {pct}%: −{sum}': 'Quantity discount {pct}%: −{sum}',
  'Оптом дешевле: {tiers}': 'Cheaper in bulk: {tiers}',
  'от {qty} — {pct}%': 'from {qty} — {pct}%',
  'Взять {qty} — скидка {pct}%': 'Take {qty} — {pct}% off',
  'От, {unit}': 'From, {unit}',
  'Ступень {n}: от какого количества': 'Tier {n}: starting quantity',
  'Ступень {n}: скидка, %': 'Tier {n}: discount, %',
  'Убрать ступень {n}': 'Remove tier {n}',
  'Добавить ступень': 'Add a tier',
  'Например, {qty} — {sum} вместо {full}.': 'For example, {qty} — {sum} instead of {full}.',
  'Берут больше — платят меньше: скидка от суммы за количество, за ваш счёт, до {max}%. Необязательно.':
    'Buy more, pay less: a discount on the total for the quantity, at your expense, up to {max}%. Optional.',
  'оптом до −{pct}%': 'bulk up to −{pct}%',

  // Лента подписок
  'Не удалось загрузить ленту.': 'Couldn’t load the feed.',
  'Что показать': 'What to show',
  Новое: 'New',
  'Со скидкой': 'On sale',
  'Продавцы · {n}': 'Sellers · {n}',
  'У продавцов из подписок сейчас нет предложений.': 'Sellers you follow have no offers right now.',
  'Скидок у продавцов из подписок сейчас нет.': 'Sellers you follow have no discounts right now.',
  'С прошлого визита: {lots}': 'Since your last visit: {lots}',

  // Копировать лот
  Копировать: 'Copy',
  'Копировать «{title}»': 'Copy “{title}”',
  'Копия лота': 'Copy of a listing',
  'Всё — как у «{title}»: поправьте, что нужно, и опубликуйте. Исходный лот не изменится.':
    'Everything is as in “{title}”: change what you need and publish. The original listing stays as it is.',
  'Товар со склада не копируется — загрузите его после публикации.':
    'Stock items aren’t copied — upload them after publishing.',
  'Заблокированный модератором лот скопировать нельзя.':
    'A listing blocked by a moderator can’t be copied.',

  // Цены разом
  'Цена ±%': 'Price ±%',
  'Цены изменены: {n}.': 'Prices changed: {n}.',
  'идёт скидка — {n}': 'discount running — {n}',
  'пополнение — {n}': 'top-up — {n}',
  'меньше 1 ₽ — {n}': 'under 1 ₽ — {n}',
  'без изменений — {n}': 'unchanged — {n}',
  'недоступны — {n}': 'unavailable — {n}',
  'Пропустили {n}: {why}.': 'Skipped {n}: {why}.',
  'На сколько процентов изменить цену, например +7 или −5':
    'By how many percent to change the price, for example +7 or −5',
  'и ещё {n}': 'and {n} more',
  'Цена в целых рублях останется в рублях: 999 ₽ +7% — 1 069 ₽.':
    'A price in whole rubles stays in whole rubles: 999 ₽ +7% is 1,069 ₽.',
  'Не изменятся {n}: идёт скидка, пополнение или лот заблокирован.':
    '{n} won’t change: a discount is running, it’s a top-up or the listing is blocked.',
  'Изменить цены {pct}: {n}': 'Change prices {pct}: {n}',
  'Изменить цены': 'Change prices',

  // Честная скидка
  'После скидки вернётся {list}.': 'After the discount it goes back to {list}.',
  'За {n} дней до скидки цена была ниже — {ref}. Покупатели увидят скидку от неё: поднять цену накануне и зачеркнуть её не выйдет.':
    'In the {n} days before the discount the price was lower — {ref}. Buyers will see the discount from it: raising the price the day before and striking it through won’t work.',
  'От {ref} это скидка {off}% — нужно от {min}%. Дайте скидку больше.':
    'From {ref} that’s a {off}% discount — at least {min}% is needed. Give a bigger discount.',
  // Страница «Уведомления»
  'Не удалось загрузить уведомления.': 'Couldn’t load notifications.',
  'Не удалось отметить уведомления.': 'Couldn’t mark notifications as read.',
  'Всё, что происходило со сделками, спорами и аккаунтом. Сообщения — в «Сообщениях».':
    'Everything that happened with your deals, disputes and account. Messages are in Messages.',
  'Группы уведомлений': 'Notification groups',
  'Только непрочитанные': 'Unread only',
  'Прочитать все в группе': 'Mark the group as read',
  'Непрочитанных уведомлений нет.': 'No unread notifications.',
  'В этой группе уведомлений пока нет.': 'No notifications in this group yet.',
  'Уведомлений пока нет. Здесь появятся оплаты, выдачи, споры, отзывы и всё, что касается аккаунта.':
    'No notifications yet. Payments, deliveries, disputes, reviews and everything about your account will appear here.',
  'не прочитано': 'unread',
  'Все уведомления': 'All notifications',
  // «Споры» в кабинете
  'Ваш ход — осталось {left}': 'Your turn — {left} left',
  'Ваш ход': 'Your turn',
  'Ждём ответа продавца': 'Waiting for the seller',
  'Ждём ответа покупателя': 'Waiting for the buyer',
  'Не удалось загрузить споры.': 'Couldn’t load disputes.',
  'Споры по вашим покупкам и продажам. У стороны, от которой ждут ответа, 24 часа — пропущенный срок арбитр учтёт при решении.':
    'Disputes over your purchases and sales. The side whose reply is needed has 24 hours — the arbiter takes a missed deadline into account.',
  'Открытые': 'Open',
  'Закрытые': 'Closed',
  'Ждут вашего ответа: {n}': 'Waiting for your reply: {n}',
  'Открытых споров нет. Если с товаром что-то не так, спор открывают на странице заказа — деньги остаются у площадки, пока его не решат.':
    'No open disputes. If something is wrong with an item, open a dispute on the order page — the marketplace holds the money until it’s resolved.',
  'Закрытых споров пока нет.': 'No closed disputes yet.',
  'вы покупатель, продавец {name}': 'you’re the buyer, seller {name}',
  'вы продавец, покупатель {name}': 'you’re the seller, buyer {name}',
  'открыт {date}': 'opened {date}',
  // «Отзывы» в кабинете
  'Не удалось загрузить отзывы.': 'Couldn’t load reviews.',
  'Отзывы покупателей о вас и ваши отзывы о продавцах. Ответ на отзыв видят все покупатели в вашем профиле.':
    'Buyers’ reviews of you and your reviews of sellers. Every buyer sees your reply to a review on your profile.',
  'Полученные': 'Received',
  'Оставленные': 'Written',
  'Без ответа': 'Unanswered',
  'Вы ещё не оставляли отзывов. Оценить продавца можно на странице заказа после подтверждения получения.':
    'You haven’t written any reviews yet. You can rate a seller on the order page after confirming receipt.',
  'На все отзывы вы уже ответили.': 'You’ve replied to every review.',
  'Отзывов о вас пока нет. Они появятся после завершённых продаж.':
    'No reviews of you yet. They appear after completed sales.',
  'продавцу {name}': 'to seller {name}',
  'Ваш ответ:': 'Your reply:',
  'Ответ на отзыв': 'Reply to the review',
  'можно до {date}': 'until {date}',
};
