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
  'В избранном пока пусто.': 'Your favorites list is empty.',

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
  'Автоподнятие, приветствие, заготовки ответов и автоответы на команды — без сторонних ботов с доступом к аккаунту.':
    'Auto-raise, a greeting, reply templates and command auto-replies — no third-party bots with access to your account.',
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
  'За этот период операций нет.': 'No transactions in this period.',
  'Показаны последние {n} операций из {total} — все в файле.':
    'Showing the latest {n} of {total} transactions — the file has them all.',

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
  'Лот подешевеет хотя бы на {pct}% — придёт уведомление. Настройка — в группе «Поиски и избранное».':
    'If a listing gets at least {pct}% cheaper, you get a notification. Set it up under “Searches and favorites”.',
  'было {price}': 'was {price}',

  // Статистика лотов
  Статистика: 'Stats',
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
};
