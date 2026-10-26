import type { Phrasebook } from '@gamemarket/shared';

/**
 * Ошибки API по-английски: русский текст ошибки → английский. Фраза с
 * подстановкой («Поднять можно через {min} мин») переводит любую строку
 * этого вида. Строки общих модулей (проверки пополнения, количества,
 * способы оплаты) — в EN_SHARED из @gamemarket/shared, здесь не повторяются.
 *
 * Новая русская ошибка без перевода роняет test/i18n.test.ts: сканер
 * находит тексты исключений и проверок в apps/api/src.
 */
export const EN_API: Phrasebook = {
  // Лимиты запросов и готовность сервиса
  'Слишком много запросов. Подождите {n} сек. и попробуйте снова.':
    'Too many requests. Wait {n} s and try again.',
  'База данных недоступна': 'The database is unavailable',

  // Доступ и статус аккаунта
  'Аккаунт заморожен модератором: покупки, продажи и вывод недоступны. Напишите в поддержку.':
    'Your account has been frozen by a moderator: purchases, sales and withdrawals are unavailable. Contact support.',
  'Аккаунт заблокирован': 'Account blocked',
  'Аккаунт заблокирован. Если это ошибка — напишите в поддержку.':
    'Account blocked. If this is a mistake, contact support.',
  'Не аутентифицирован': 'Not signed in',
  'Недостаточно прав': 'Insufficient permissions',

  // Чёрный список
  'Продавец ограничил вам покупки': 'The seller has restricted your purchases',
  'Пользователь ограничил переписку с вами': 'This user has restricted messages from you',
  'Пользователь в вашем чёрном списке — уберите его оттуда, чтобы продолжить':
    'This user is on your block list — remove them to continue',
  'Себя в чёрный список не добавить': 'You can’t block yourself',
  'Пользователь не найден': 'User not found',
  'Сотрудника площадки в чёрный список не добавить': 'You can’t block a marketplace staff member',

  // Профиль и настройки
  'Неверный ключ подписки': 'Invalid subscription key',
  'Имя — от 2 символов': 'Name must be at least 2 characters',
  'Имя — до 40 символов': 'Name must be at most 40 characters',
  'О себе — до 500 символов': '“About” must be at most 500 characters',
  'Telegram-бот на стенде не подключён': 'The Telegram bot isn’t connected on this site',
  'Профиль не найден': 'Profile not found',
  'Хранилище картинок на стенде не подключено': 'Image storage isn’t connected on this site',
  'Пустой файл': 'The file is empty',
  'Аватар — PNG, JPG, WebP или GIF': 'Avatar must be PNG, JPG, WebP or GIF',
  'Аватар больше 2 МБ': 'Avatar is larger than 2 MB',
  'Пуш-уведомления на стенде выключены': 'Push notifications are turned off on this site',
  'Подписка не от службы пушей браузера': 'The subscription isn’t from a browser push service',

  // Консоль сотрудника
  'Роль не найдена': 'Role not found',
  'Свою роль администратора снять нельзя — попросите другого администратора':
    'You can’t remove your own admin role — ask another administrator',

  // Вход, регистрация, сеансы
  'Новый пароль — от 8 символов': 'New password must be at least 8 characters',
  'Пользователь с таким email или username уже есть':
    'A user with this email or username already exists',
  'Ссылка недействительна или истекла': 'The link is invalid or has expired',
  'Слишком много попыток входа. Попробуйте через {min} мин.':
    'Too many sign-in attempts. Try again in {min} min.',
  'Слишком много попыток. Попробуйте через {min} мин.': 'Too many attempts. Try again in {min} min.',
  'Так выключить нельзя: когда включали вход с кодом, у аккаунта не было пароля':
    'This can’t be turned off this way: the account had no password when the sign-in code was turned on',
  'Это не тот пароль, что был у аккаунта, когда включали вход с кодом':
    'This isn’t the password the account had when the sign-in code was turned on',
  // «Не могу войти»: заявка на восстановление доступа
  'Не больше трёх номеров заказов': 'No more than three order numbers',
  'Опишите, что случилось, — от 10 символов': 'Describe what happened — at least 10 characters',
  'Причина — от 5 символов': 'The reason must be at least 5 characters',
  'По заявке уже решено': 'This request has already been decided',
  'Решить можно через 3 дня после заявки: владелец должен успеть её увидеть':
    'You can decide 3 days after the request: the owner must have time to see it',
  'В заявке нет новой почты': 'The request has no new email',
  'У аккаунта нет пройденной проверки личности — сверять документы не с чем':
    'The account has no approved ID check, so there is nothing to compare the documents with',
  'Документы уже отправлены': 'Documents have already been sent',
  'Документы по ссылке ещё не присланы': 'The documents from the link haven’t been sent yet',
  'Эта почта уже у другого аккаунта': 'This email already belongs to another account',
  'У аккаунта пройдена проверка личности — попросите документы, они надёжнее':
    'The account has an approved ID check — ask for documents, they are more reliable',
  'Описания уже отправлены': 'The descriptions have already been sent',
  'Описания сделок по ссылке ещё не присланы': 'The deal descriptions from the link haven’t been sent yet',
  'Каждая сделка — с другим продавцом или покупателем': 'Each deal must be with a different seller or buyer',
  'Укажите ник продавца или покупателя': 'Enter the seller’s or buyer’s username',
  'Опишите сделку подробнее — от 20 символов': 'Describe the deal in more detail — at least 20 characters',
  'Описание сделки — до 600 символов': 'The deal description must be at most 600 characters',
  'Опишите хотя бы две сделки': 'Describe at least two deals',
  'Не больше трёх сделок': 'No more than three deals',
  'Из аккаунта отметили «Заявку подал не я» — по сделкам на новую почту не восстановить':
    'Someone in the account marked “I didn’t file this request” — the account can’t be moved to a new email based on deals',
  'Участник сделки ответил, что описание не совпадает':
    'A deal participant answered that the description doesn’t match',
  'Нужны подтверждения хотя бы двух разных участников сделок':
    'Confirmations from at least two different deal participants are needed',
  'Вы уже ответили': 'You have already answered',
  'Просьба не найдена или заявку уже решили': 'The request wasn’t found or has already been decided',
  'Неверные данные': 'Incorrect email or password',
  'Невалидный refresh-токен': 'Invalid refresh token',
  'Сессия недействительна': 'Session is no longer valid',
  'Обнаружено повторное использование refresh-токена': 'Refresh token reuse detected',
  'Текущий пароль неверный': 'Current password is incorrect',
  'Новый пароль совпадает с текущим': 'The new password is the same as the current one',
  'Это текущий сеанс — чтобы выйти на этом устройстве, нажмите «Выйти»':
    'This is your current session — to sign out on this device, click “Sign out”',
  'Сеанс уже завершён': 'Session already ended',
  'Сеанс не найден': 'Session not found',
  'Нет токена': 'No token',
  'Невалидный токен': 'Invalid token',
  'Сеанс завершён': 'Session ended',

  // Код из приложения
  'Сначала вызовите /auth/2fa/setup': 'Call /auth/2fa/setup first',
  'Неверный код': 'Incorrect code',
  'Двухфакторная защита не включена': 'Two-factor protection isn’t enabled',
  'Введите код из приложения-аутентификатора': 'Enter the code from your authenticator app',
  'Код не подошёл. Проверьте время на телефоне или введите резервный код':
    'The code didn’t work. Check the time on your phone or enter a backup code',
  'Слишком много неверных кодов. Попробуйте через 15 минут':
    'Too many incorrect codes. Try again in 15 minutes',

  // Вход через сервисы
  'Слишком много полей': 'Too many fields',
  'Нет такого сервиса': 'No such service',
  'Вход через {provider} не подключён': 'Sign-in with {provider} isn’t enabled',
  'Telegram не подтвердил вход — попробуйте ещё раз':
    'Telegram didn’t confirm the sign-in — try again',
  'Вход через сервис устарел — начните заново': 'The sign-in has expired — start again',
  'Аккаунт с почтой {email} уже есть. Войдите по почте и паролю и подключите {provider} в «Безопасности».':
    'An account with the email {email} already exists. Sign in with your email and password and connect {provider} in “Security”.',
  'Выберите ник — по нему вас найдут покупатели и продавцы':
    'Choose a username — buyers and sellers will find you by it',
  'Ник: {reason}': 'Username: {reason}',
  'не подходит': 'not valid',
  'Этот ник занят': 'This username is taken',
  'Ник или аккаунт уже заняты — обновите страницу и попробуйте ещё раз':
    'The username or account is already taken — refresh the page and try again',
  'К аккаунту уже подключён другой {provider} — сначала отключите его в «Безопасности»':
    'Another {provider} account is already connected — disconnect it in “Security” first',
  'Этот {provider} уже привязан к другому аккаунту':
    'This {provider} account is already linked to another account',
  'Сервис не подключён': 'Service not connected',
  'Это единственный способ входа — сначала задайте пароль':
    'This is your only way to sign in — set a password first',
  'Это единственный способ входа — сначала подключите другой сервис':
    'This is your only way to sign in — connect another service first',

  // Каталог и лоты
  'Игра не найдена': 'Game not found',
  'Лот не найден': 'Listing not found',
  'Это ваш лот': 'This is your listing',
  'Это не ваш лот': 'This isn’t your listing',
  'Лот недоступен': 'The listing is unavailable',
  'Продавец не найден': 'Seller not found',
  'Продвигать можно только лот в продаже': 'Only a listing that’s on sale can be promoted',
  'На балансе не хватает {sum} ₽ — пополните баланс': 'Your balance is {sum} ₽ short — top it up',
  'Допустимы только изображения': 'Only images are allowed',
  'Изображение больше 8 МБ': 'Image is larger than 8 MB',
  'Поднять можно только активный лот': 'Only an active listing can be raised',
  'Поднять можно через {min} мин': 'You can raise it again in {min} min',
  'Категория не найдена для указанной игры': 'Category not found for this game',
  'Валюту продают количеством — автовыдача со склада здесь не подходит':
    'Currency is sold by quantity — auto-delivery from stock doesn’t apply here',
  'Сумму на выбор покупателя можно задать только у пополнений':
    'A buyer-chosen amount can only be set for top-ups',
  'Данные от покупателя спрашивают только у лотов с ручной выдачей':
    'Buyer details can only be requested for manually delivered listings',
  'В этом разделе продают количеством: укажите цену за {units}':
    'This category sells by quantity: set the price per “{units}”',
  'У пополнений количество не задаётся — выберите сумму на выбор покупателя':
    'Top-ups have no quantity — choose a buyer-chosen amount instead',
  'Укажите характеристику «{label}»': 'Fill in “{label}”',
  'Недопустимое значение «{label}»': 'Invalid value for “{label}”',
  'Лот заблокирован модератором. Напишите в поддержку.':
    'The listing has been blocked by a moderator. Contact support.',
  'Склад пуст — загрузите товар, и лот вернётся в продажу':
    'Stock is empty — upload goods and the listing will go back on sale',
  'Лот закончился — укажите наличие': 'The listing is out of stock — set the stock',

  // Склад автовыдачи
  'На складе такого нет': 'This item isn’t in stock',
  'Это не ваш склад': 'This isn’t your stock',
  'Уже зарезервировано или выдано покупателю': 'Already reserved or delivered to a buyer',
  'Склад есть только у лотов с автовыдачей': 'Only auto-delivery listings have stock',

  // Заказы
  'Нельзя купить собственный лот': 'You can’t buy your own listing',
  'У этого лота фиксированная цена — сумму выбирает продавец':
    'This listing has a fixed price — the seller sets the amount',
  'Этот лот продаётся целиком': 'This listing is sold as a whole',
  'Заказ не найден': 'Order not found',
  'Это не ваш заказ': 'This isn’t your order',
  'Товар ещё не выдан': 'The goods haven’t been delivered yet',
  'Для этого заказа нет авто-выданного ключа': 'This order has no auto-delivered key',
  'Ключ не найден': 'Key not found',
  'Нет доступа к заказу': 'No access to this order',
  'Нельзя отменить заказ в статусе {status}': 'An order with status {status} can’t be cancelled',
  'Вернуть деньги может только продавец': 'Only the seller can issue a refund',
  'Деньги по этому заказу уже не у площадки':
    'The marketplace no longer holds the money for this order',
  'Заказ не в статусе спора': 'The order isn’t in dispute',
  'Недопустимый переход {from} → {to}': 'Invalid status change {from} → {to}',

  // Оплата
  'Этот способ оплаты сейчас недоступен — выберите другой.':
    'This payment method isn’t available right now — choose another one.',
  'Платёжный шлюз не ответил. Попробуйте ещё раз.':
    'The payment gateway didn’t respond. Try again.',
  'Платёжный шлюз не принял платёж. Попробуйте ещё раз или выберите другой способ.':
    'The payment gateway didn’t accept the payment. Try again or choose another method.',
  'Для чека об оплате нужна почта: добавьте её в настройках профиля.':
    'A receipt needs an email address: add one in your profile settings.',
  'Сумма платежа не совпадает с заказом': 'The payment amount doesn’t match the order',
  'ожидается положительное число минорных единиц':
    'expected a positive whole number of minor units',
  'Сумма должна быть положительной': 'The amount must be positive',
  'Заказ уже оплачен или закрыт': 'The order is already paid or closed',
  'Невалидная подпись вебхука': 'Invalid webhook signature',
  'Платёж не найден': 'Payment not found',
  'Платёж создан другим провайдером': 'The payment was created by another provider',
  'Платёжный провайдер "{key}" не найден': 'Payment provider "{key}" not found',

  // Баланс и вывод
  'Телефон для СБП — российский номер, например +7 900 000-00-00':
    'The SBP phone must be a Russian number, for example +7 900 000-00-00',
  'Выберите банк, в который придёт перевод по СБП':
    'Choose the bank that will receive the SBP transfer',
  'Номер кошелька ЮMoney — от 11 до 20 цифр': 'A YooMoney wallet number has 11 to 20 digits',
  'Реквизиты заявки не подходят для автоматической выплаты — отклоните её':
    'The request’s details don’t fit an automatic payout — reject it',
  'Платёжный шлюз не принял выплату. Попробуйте ещё раз.':
    'The payment gateway didn’t accept the payout. Try again.',
  'Сумма выплаты не совпадает с заявкой': 'The payout amount doesn’t match the request',
  'Введите карту в форме ЮKassa: номер карты площадка не принимает':
    'Enter the card in the YooKassa form: the marketplace doesn’t accept card numbers',
  'Укажите реквизиты для вывода': 'Enter the withdrawal details',
  'Карта сохранена в ЮKassa — эту заявку выплачивает только она. Включите выплаты через ЮKassa или отклоните заявку':
    'The card is stored with YooKassa, so only YooKassa can pay this request. Turn on YooKassa payouts or reject the request',
  'Эту выплату отправляет ЮKassa — реквизиты у неё':
    'YooKassa sends this payout and holds its details',

  // Споры
  'Закрыть спор без претензий может только покупатель':
    'Only the buyer can close a dispute with no claims',

  // Отзывы с фото
  'Не больше {n} фото к отзыву': 'No more than {n} photos per review',
  'Фото не найдено — загрузите его заново': 'Photo not found — upload it again',

  // Отчёты
  'Период — от 1 до 366 дней': 'The period must be from 1 to 366 days',

  // Инструменты продавца
  'Приветствие — до 1000 символов': 'The greeting can be up to 1000 characters',
  'Назовите заготовку': 'Give the template a name',
  'Название — до 60 символов': 'The name can be up to 60 characters',
  'Текст заготовки пустой': 'The template text is empty',
  'Заготовка — до 2000 символов': 'A template can be up to 2000 characters',
  'Не больше {n} заготовок — удалите ненужные':
    'No more than {n} templates — delete the ones you don’t need',
  'Заготовка не найдена': 'Template not found',
  'Команда — до {n} символов': 'A command can be up to {n} characters',
  'Команда — в одну строку': 'A command must fit on one line',
  'Команда {command} уже есть у заготовки «{title}»':
    'The command {command} is already used by the template “{title}”',

  // Сохранённые поиски
  'Цена — до 10 млн ₽': 'The price can be up to 10 million ₽',
  'Текст поиска — до 100 символов': 'Search text can be up to 100 characters',
  'В разделе нет такого фильтра': 'This category has no such filter',
  'Такой поиск уже сохранён': 'This search is already saved',
  'Не больше {n} поисков — удалите ненужные':
    'No more than {n} saved searches — delete the ones you don’t need',
  'Поиск не найден': 'Search not found',

  // Статистика лотов
  'Период — 7, 30 или 90 дней': 'The period must be 7, 30 or 90 days',

  // Скидка на лот
  'Скидка — от {n}%': 'The discount must be at least {n}%',
  'Скидка — до {n}%': 'The discount can be up to {n}%',
  'Срок — от суток': 'The period must be at least one day',
  'Срок — до {n} суток': 'The period can be up to {n} days',
  'Скидку можно дать лоту в продаже': 'Only a listing on sale can get a discount',
  'У пополнения скидка — это наценка: измените её в лоте':
    'For a top-up, the discount is the markup: change it in the listing',
  'Скидка уже идёт — завершите её, чтобы начать новую':
    'A discount is already running — end it to start a new one',
  'Со скидкой цена меньше 1 ₽': 'With the discount, the price would be below 1 ₽',
  'Лот только что изменился — обновите страницу': 'The listing has just changed — refresh the page',
  'Скидки на этом лоте нет': 'This listing has no discount',
  'Идёт скидка — завершите её, потом меняйте цену':
    'A discount is running — end it before changing the price',
  'За {n} дней до скидки цена была {price} — от неё скидка {off}%, а нужно от {min}%. Дайте скидку больше или подождите неделю после повышения цены':
    'In the {n} days before the discount the price was {price} — the discount from it is {off}%, and at least {min}% is needed. Give a bigger discount or wait a week after raising the price',

  // Промокоды продавца
  'Укажите код': 'Enter a code',
  'Код — до 20 знаков': 'A code can be up to 20 characters',
  'Использований — от одного': 'At least one use',
  'Срок — до года': 'The period can be up to a year',
  'Продавец выключил этот промокод': 'The seller has turned this promo code off',
  'Срок промокода продавца истёк': 'The seller’s promo code has expired',
  'Промокод продавца не действует на пополнение':
    'The seller’s promo code doesn’t apply to top-ups',
  'Промокод продавца закончился': 'The seller’s promo code has run out',
  'Вы уже покупали по этому промокоду': 'You have already used this promo code',
  'Промокод — для тех, кто уже покупал у этого продавца':
    'This promo code is for those who have bought from this seller before',
  'Не больше {n} промокодов — удалите ненужные':
    'No more than {n} promo codes — delete the ones you don’t need',
  'Такой код у вас уже есть': 'You already have this code',
  'Промокод не найден': 'Promo code not found',

  // Скидка за количество
  'Скидка за количество — у лотов, которые продают количеством':
    'A quantity discount is only for listings sold by quantity',

  // Подписки на продавцов
  'На себя подписаться нельзя': 'You can’t follow yourself',
  'Не больше {n} подписок — отпишитесь от ненужных':
    'No more than {n} follows — unfollow the ones you don’t need',
  'Подписка не найдена': 'Follow not found',

  // Загрузка лотов из таблицы
  'В этот раздел лоты выставляются по одному: из таблицы — аккаунты, предметы и услуги':
    'Listings in this category are added one by one: tables are for accounts, items and services',
  'Не удалось выставить лот': 'Couldn’t list this one',
  'Этот лот — из другого раздела': 'This listing is from another category',
  'Поштучный лот и лот с автовыдачей меняются в форме лота':
    'Listings sold by quantity or with auto-delivery are edited in the listing form',

  // Оценка покупателя
  'Оценить покупателя может только продавец': 'Only the seller can rate the buyer',
  'Оценить покупателя можно после завершения сделки': 'You can rate the buyer once the deal is closed',
  'Оценку ставят в течение {n} дней после сделки': 'A rating can be given within {n} days of the deal',
  'Комментарий — до 300 знаков': 'The comment must be up to 300 characters',

  // Сообщить о поступлении
  'Лот в продаже — его можно купить сейчас': 'The listing is in stock — you can buy it now',
  'Ждать можно не больше {n} лотов сразу': 'You can wait for no more than {n} listings at once',
  'Раздел не найден': 'Category not found',
  'Недостаточно средств на балансе': 'Insufficient balance',
  'Неизвестный способ вывода': 'Unknown withdrawal method',
  'Минимальная сумма вывода для «{method}» — {sum} ₽':
    'The minimum withdrawal for “{method}” is {sum} ₽',
  'Максимум для «{method}» — {sum} ₽': 'The maximum for “{method}” is {sum} ₽',
  'Вывод больше {sum} ₽ — после проверки личности: «Безопасность» → «Проверка личности»':
    'Withdrawals over {sum} ₽ require ID verification: “Security” → “ID verification”',
  'На холде до {date}': 'On hold until {date}',
  'Заявка на вывод не найдена': 'Withdrawal request not found',
  'Промокод недействителен': 'The promo code is invalid',
  'Процент должен быть в диапазоне 1..100': 'The percentage must be between 1 and 100',

  // Сообщения и файлы
  'Сообщение не отправлено': 'Message not sent',
  'Хранилище недоступно': 'Storage is unavailable',
  'Диалог не найден': 'Conversation not found',
  'Нет доступа к диалогу': 'No access to this conversation',
  'Пустое сообщение': 'The message is empty',
  'Файл не прошёл антивирус-проверку: {reason}': 'The file failed the antivirus check: {reason}',
  'проверка антивирусом недоступна, попробуйте позже':
    'the antivirus check is unavailable, try again later',
  'превышен лимит {size}': 'the {size} size limit is exceeded',
  '{n} МБ': '{n} MB',
  '{n} байт': '{n} bytes',
  'сигнатура EICAR': 'EICAR signature',
  'Ссылка недействительна': 'The link is invalid',
  'Этот тип файла не загрузить': 'This file type can’t be uploaded',
  'Файл больше 15 МБ': 'The file is larger than 15 MB',

  // Споры
  'Спор по этому заказу уже открыт': 'A dispute for this order is already open',
  'Внутренние заметки — только арбитр': 'Only the arbiter can add internal notes',
  'Спор уже в работе или закрыт': 'The dispute is already being handled or is closed',
  'Спор уже разрешён': 'The dispute has already been resolved',
  'Спор не найден': 'Dispute not found',
  'Нет доступа к спору': 'No access to this dispute',

  // Жалобы и модерация
  'На свой лот жаловаться не нужно': 'You don’t need to report your own listing',
  'На себя жаловаться не нужно': 'You don’t need to report yourself',
  'Сообщение не найдено': 'Message not found',
  'На своё сообщение жаловаться не нужно': 'You don’t need to report your own message',
  'Жалоба не найдена': 'Report not found',
  'Действие над нарушителем — только вместе с решением жалобы':
    'Action against the violator is only possible together with resolving the report',
  'Заблокировать можно только лот': 'Only a listing can be blocked',
  'Лот не заблокирован': 'The listing isn’t blocked',
  'Свой аккаунт так не меняют': 'You can’t change your own account this way',
  'Статус сотрудника меняет только администратор':
    'Only an administrator can change a staff member’s status',

  // Отзывы
  'Нечего менять': 'Nothing to change',
  'Отзыв оставляет покупатель': 'Only the buyer can leave a review',
  'Сделка ещё не завершена': 'The deal isn’t completed yet',
  'Отзыв по этому заказу уже есть': 'This order already has a review',
  'Отзыв не найден': 'Review not found',
  'Отвечать может только продавец': 'Only the seller can reply',
  'Напишите ответ': 'Write a reply',
  'Менять отзыв может только его автор': 'Only the author can edit the review',
  'Отзыв можно изменить в первые {days} дней':
    'A review can be edited within the first {days} days',

  // Проверка личности
  'Добавьте фото документа': 'Add a photo of the document',
  'Документ — до двух фото': 'Up to two photos of the document',
  'Подойдёт фото (JPG, PNG, WebP, HEIC) или PDF': 'Use a photo (JPG, PNG, WebP, HEIC) or a PDF',
  'Файлы не из этой заявки — загрузите их заново':
    'These files aren’t from this request — upload them again',
  'Одно и то же фото дважды': 'The same photo was added twice',
  'Документы уже на проверке': 'Your documents are already being reviewed',
  'Документы уже проверены': 'Your documents are already verified',
  'Файл не загрузился — добавьте его ещё раз': 'The file didn’t upload — add it again',
  'Напишите, что не так: продавец увидит причину и переснимет':
    'Write what’s wrong: the seller will see the reason and retake the photo',
  'Заявка не найдена': 'Request not found',
  'Заявка уже обработана': 'The request has already been processed',

  // Поддержка
  'Тема — от 3 символов': 'Subject must be at least 3 characters',
  'Опишите вопрос подробнее — от 10 символов':
    'Describe your question in more detail — at least 10 characters',
  'У вас уже пять открытых обращений — дождитесь ответа по ним':
    'You already have five open requests — wait for replies to them',
  'Обращение не найдено': 'Request not found',
  'Это не ваше обращение': 'This isn’t your request',
};
