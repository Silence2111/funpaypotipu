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
  'Неверные данные': 'Incorrect email or password',
  'Невалидный refresh-токен': 'Invalid refresh token',
  'Сессия недействительна': 'Session is no longer valid',
  'Обнаружено повторное использование refresh-токена': 'Refresh token reuse detected',
  'Текущий пароль неверный': 'Current password is incorrect',
  'Новый пароль совпадает с текущим': 'The new password is the same as the current one',
  'Это текущий сеанс — чтобы выйти на этом устройстве, нажмите «Выйти»':
    'This is your current session — to sign out on this device, click “Sign out”',
  'Сеанс уже завершён': 'Session already ended',
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
  'ожидается положительное число минорных единиц':
    'expected a positive whole number of minor units',
  'Сумма должна быть положительной': 'The amount must be positive',
  'Заказ уже оплачен или закрыт': 'The order is already paid or closed',
  'Невалидная подпись вебхука': 'Invalid webhook signature',
  'Платёж не найден': 'Payment not found',
  'Платёж создан другим провайдером': 'The payment was created by another provider',
  'Платёжный провайдер "{key}" не найден': 'Payment provider "{key}" not found',

  // Баланс и вывод
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
