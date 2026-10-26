/** Аккаунт: настройки, безопасность, код из приложения, уведомления, проверка личности, вход через сервисы. */
export const ACCOUNT: Record<string, string> = {
  // Безопасность: пароль и сеансы
  // Заявка «Не могу войти» на этот аккаунт
  'Заявка на восстановление доступа': 'Account recovery request',
  'подана {when}': 'filed {when}',
  'Кто-то сообщил поддержке, что не может войти в этот аккаунт. Сотрудник решит не раньше {date}. Если это вы — ждите ответа на почту. Если не вы — отметьте это, сотрудник увидит до решения.':
    'Someone told support they can’t sign in to this account. Staff won’t decide before {date}. If it was you, wait for a reply by email. If not, mark it — staff will see this before deciding.',
  'Отмечено: заявку подали не вы': 'Marked: you didn’t file this request',
  'Кто-то сообщил поддержке, что не может войти в этот аккаунт, и просит сменить его почту. Сотрудник решит не раньше {date}. Если это не вы — обязательно отметьте это.':
    'Someone told support they can’t sign in to this account and asked to change its email. Staff won’t decide before {date}. If it wasn’t you, be sure to mark it.',
  'Заявку подал не я': 'I didn’t file this',
  'Отмечено: сотрудник увидит, что заявку подали не вы.':
    'Marked: staff will see that you didn’t file this request.',
  'Не удалось отметить заявку.': 'Couldn’t mark the request.',
  // Вопрос «Это были вы?» после входа с нового устройства
  'Вход с нового устройства': 'Sign-in from a new device',
  'Это были вы?': 'Was this you?',
  'Это не я — завершить сеанс': 'It wasn’t me — end the session',
  'Да, это я': 'Yes, it was me',
  Понятно: 'Got it',
  'новый вход': 'new sign-in',
  'Сеанс завершён — устройство вышло из аккаунта. Смените пароль: тогда выйдут и все остальные устройства.':
    'Session ended — the device was signed out. Change your password to sign out all other devices too.',
  'Сеанс завершён — устройство вышло из аккаунта. Проверьте, какие сервисы подключены для входа.':
    'Session ended — the device was signed out. Check which services are connected for sign-in.',
  'Этот вход — с устройства, на котором вы сейчас. Если это были вы, ничего делать не нужно.':
    'This sign-in is from the device you’re using now. If it was you, there’s nothing to do.',
  'Этот сеанс уже завершён: устройство вышло из аккаунта. Если входили не вы — смените пароль.':
    'This session has already ended: the device was signed out. If it wasn’t you, change your password.',
  'Сервис подключён: теперь можно входить через него.':
    'Service connected: you can now sign in with it.',
  'Этот аккаунт сервиса уже привязан к другому пользователю площадки.':
    'This service account is already linked to another user on the marketplace.',
  'Не удалось подключить сервис. Попробуйте ещё раз.': 'Couldn’t connect the service. Try again.',
  'Новый пароль — от 8 символов': 'New password must be at least 8 characters',
  'Пароль задан: теперь можно входить и по почте с паролем.':
    'Password set: you can now also sign in with email and password.',
  'Пароль изменён. Другие устройства вышли из аккаунта: {n}.':
    'Password changed. Other devices signed out: {n}.',
  'Пароль изменён.': 'Password changed.',
  'Не удалось сменить пароль.': 'Couldn’t change the password.',
  Пароль: 'Password',
  'Вход по паролю — это почта и пароль, а у аккаунта нет почты: он заведён через сервис. Подключите второй сервис ниже, чтобы не зависеть от одного.':
    'Password sign-in needs an email and a password, and this account has no email: it was created through a service. Connect a second service below so you don’t depend on just one.',
  'Пароля нет — аккаунт заведён через сервис. Задайте пароль, чтобы входить и по почте {email}.':
    'No password yet — the account was created through a service. Set a password to also sign in with {email}.',
  'Текущий пароль': 'Current password',
  'Новый пароль': 'New password',
  'От 8 символов.': 'At least 8 characters.',
  'От 8 символов. Другие устройства выйдут из аккаунта сразу.':
    'At least 8 characters. Other devices will be signed out right away.',
  'Задать пароль': 'Set password',
  'Сменить пароль': 'Change password',
  'Где выполнен вход': 'Where you’re signed in',
  'Завершено сеансов: {n}.': 'Sessions ended: {n}.',
  'Не удалось завершить сеансы.': 'Couldn’t end the sessions.',
  'Завершить все, кроме этого': 'End all except this one',
  'это устройство': 'this device',
  'вход {when}': 'signed in {when}',
  'Сеанс завершён — устройство вышло из аккаунта.':
    'Session ended — the device has been signed out.',
  'Не удалось завершить сеанс.': 'Couldn’t end the session.',
  Завершить: 'End',

  // Профиль и чёрный список
  'Не удалось загрузить профиль': 'Couldn’t load the profile',
  'Профиль сохранён. Контакты в «О себе» скрываются, как в чате.':
    'Profile saved. Contacts in “About” are hidden, just like in chat.',
  'Не удалось сохранить профиль.': 'Couldn’t save the profile.',
  'Аватар не загрузился.': 'The avatar didn’t upload.',
  'Не удалось убрать из чёрного списка.': 'Couldn’t remove from the block list.',
  'Сменить аватар': 'Change avatar',
  'Загрузить аватар': 'Upload avatar',
  Убрать: 'Remove',
  Ник: 'Username',
  '— не меняется: по нему находят ваши лоты и отзывы':
    '— can’t be changed: people find your listings and reviews by it',
  'Имя на витрине': 'Display name',
  'О себе — необязательно': 'About — optional',
  'Что продаёте, как быстро отвечаете, в какое время на связи':
    'What you sell, how fast you reply, when you’re available',
  '{n} / 500. Видно покупателям на странице продавца.':
    '{n} / 500. Buyers see this on your seller page.',
  Почта: 'Email',
  'не указана': 'not set',
  '— подтверждена': '— verified',
  '— не подтверждена': '— not verified',
  'Сохраняем…': 'Saving…',
  Сохранить: 'Save',
  'Чёрный список': 'Block list',
  'Кто здесь, тот не напишет вам до сделки и не купит ваши лоты. Добавить — кнопкой на странице продавца.':
    'People on this list can’t message you before a deal or buy your listings. Add someone with the button on their seller page.',
  'Список пуст.': 'The list is empty.',
  пользователь: 'user',
  'с {date}': 'since {date}',

  // Проверка личности
  'Подойдёт фото (JPG, PNG, WebP, HEIC) или PDF': 'Use a photo (JPG, PNG, WebP, HEIC) or a PDF',
  'Файл больше 15 МБ — сфотографируйте заново или сожмите':
    'The file is over 15 MB — retake the photo or compress it',
  'Убрать файл': 'Remove file',
  'Добавить ещё': 'Add another',
  'Выбрать фото или PDF': 'Choose a photo or PDF',
  'Не удалось загрузить статус проверки': 'Couldn’t load the verification status',
  'Нужны фото документа и селфи с ним': 'We need a photo of the document and a selfie with it',
  '{i} из {n}': '{i} of {n}',
  'Не удалось отправить документы. Попробуйте ещё раз.': 'Couldn’t send the documents. Try again.',
  'Проверка личности': 'ID verification',
  'Документы проверены': 'ID verified',
  '{date}. Вывод — без ограничения суммы, в профиле и на ваших лотах — «Документы проверены».':
    '{date}. Withdrawals have no amount limit, and your profile and listings show “ID verified”.',
  'Документы на проверке': 'Documents under review',
  'Отправлены {date}. Решение придёт уведомлением.':
    'Sent {date}. You’ll get a notification with the decision.',
  'Документы не приняты: {reason}. Загрузите их заново.':
    'Documents not accepted: {reason}. Please upload them again.',
  'Документы не приняты. Загрузите их заново.': 'Documents not accepted. Please upload them again.',
  'Что даёт проверка': 'What verification gives you',
  'Вывод без ограничения суммы — без проверки за раз можно вывести до {limit}':
    'Withdrawals without an amount limit — without verification you can withdraw up to {limit} at a time',
  '«Документы проверены» в профиле и в карточке продавца на ваших лотах':
    '“ID verified” on your profile and on the seller card of your listings',
  'Уровень Pro — когда хватит продаж и оценок':
    'Pro level — once you have enough sales and ratings',
  Документ: 'Document',
  'Паспорт или другой документ с фото: разворот с фотографией целиком, без бликов. Можно добавить второе фото.':
    'A passport or other photo ID: the whole photo page, without glare. You can add a second photo.',
  'Селфи с документом': 'Selfie with the document',
  'Лицо и раскрытый документ в одном кадре — так видно, что документ ваш.':
    'Your face and the open document in one shot — this shows the document is yours.',
  'Фото или PDF до 15 МБ. Документы видит только сотрудник проверки — другим пользователям они недоступны.':
    'Photos or PDF up to 15 MB. Only the verification officer sees the documents — other users can’t access them.',
  'Отправляем {progress}…': 'Sending {progress}…',
  'Отправляем…': 'Sending…',
  'Отправить на проверку': 'Submit for review',
  'не пройдена': 'not verified',
  'Пройти проверку': 'Get verified',
  'на проверке': 'under review',
  Подробнее: 'Details',
  'документы проверены': 'ID verified',
  'документы не приняты': 'not accepted',
  'Загрузить заново': 'Upload again',
  'Фото документа и селфи с ним. После проверки — вывод без ограничения суммы и «Документы проверены» в профиле.':
    'A photo of your ID and a selfie with it. Once verified — withdrawals without an amount limit and “ID verified” on your profile.',

  // Уведомления
  Пуш: 'Push',
  'На стенде выключены': 'Turned off on this site',
  ' · ещё устройств: {n}': ' · other devices: {n}',
  'Включены на этом устройстве': 'On for this device',
  'Уведомления для сайта запрещены в настройках браузера':
    'Notifications for this site are blocked in browser settings',
  'На iPhone — после установки сайта: «Поделиться» → «На экран Домой»':
    'On iPhone — after installing the site: Share → Add to Home Screen',
  'Этот браузер пуши не принимает': 'This browser doesn’t support push',
  'Включены на других устройствах: {n}': 'On for other devices: {n}',
  'Заказы и сообщения — сразу на экран, даже когда сайт закрыт':
    'Orders and messages right on your screen, even when the site is closed',
  'Не удалось загрузить настройки уведомлений': 'Couldn’t load notification settings',
  'Не удалось сохранить настройку.': 'Couldn’t save the setting.',
  'Не удалось получить ссылку на бота.': 'Couldn’t get the bot link.',
  'Не удалось отключить Telegram.': 'Couldn’t disconnect Telegram.',
  'Не удалось включить пуши на этом устройстве.': 'Couldn’t turn on push for this device.',
  'Не удалось выключить пуши.': 'Couldn’t turn off push.',
  'Письма, Telegram и пуши приходят на языке: {lang}. Он меняется вместе с языком сайта.':
    'Emails, Telegram and push notifications arrive in: {lang}. It changes along with the site language.',
  'На сайте — всегда. Письмом, в Telegram и пушем — по вашему выбору.':
    'On the site — always. By email, Telegram and push — as you choose.',
  'Бот на стенде не подключён': 'The bot isn’t connected on this site',
  Подключён: 'Connected',
  'Откройте бота и нажмите «Старт» — страница обновится сама':
    'Open the bot and tap “Start” — this page will update by itself',
  'Мгновенные уведомления о заказах и сообщениях':
    'Instant notifications about orders and messages',
  Отключить: 'Disconnect',
  'Подключить Telegram': 'Connect Telegram',
  'Пуш-уведомления': 'Push notifications',
  Выключить: 'Turn off',
  'Включить на этом устройстве': 'Turn on for this device',
  Что: 'What',

  // Вход через сервисы
  'Не удалось начать подключение.': 'Couldn’t start connecting.',
  'Telegram подключён: теперь можно входить через него.':
    'Telegram connected: you can now sign in with it.',
  'Telegram не подключился.': 'Telegram didn’t connect.',
  'Вход через сервисы': 'Sign in with services',
  'Входить в один аккаунт по паролю, через Telegram, VK ID или Google — как удобнее.':
    'Sign in to one account with a password, Telegram, VK ID or Google — whichever is easier.',
  'Не подключён': 'Not connected',
  '{name} отключён.': '{name} disconnected.',
  'Не удалось отключить.': 'Couldn’t disconnect.',
  Подключить: 'Connect',
  'Пароля у аккаунта нет — вход только через сервис. Задайте пароль выше, чтобы не зависеть от него.':
    'This account has no password — you can only sign in through a service. Set a password above so you don’t depend on it.',

  // Код из приложения
  'Защита включена. Сохраните резервные коды — они понадобятся без телефона.':
    'Two-factor authentication is on. Save your backup codes — you’ll need them if you lose your phone.',
  'Код не подошёл.': 'The code didn’t work.',
  'Новые резервные коды — старые больше не работают.':
    'New backup codes — the old ones no longer work.',
  'Двухфакторная защита отключена.': 'Two-factor authentication is off.',
  'Резервные коды GameMarket — каждый работает один раз':
    'GameMarket backup codes — each works once',
  'Двухфакторная защита': 'Two-factor authentication',
  'При входе, кроме пароля, нужен код из приложения-аутентификатора: Google Authenticator, 1Password и похожих.':
    'When you sign in, besides your password you’ll need a code from an authenticator app: Google Authenticator, 1Password and similar.',
  'Резервные коды — каждый работает один раз': 'Backup codes — each works once',
  'Сохраните их там, где нет телефона: в менеджере паролей или на бумаге. Больше мы их не покажем.':
    'Keep them somewhere other than your phone: in a password manager or on paper. We won’t show them again.',
  Скопировать: 'Copy',
  Скачать: 'Download',
  'Коды сохранены': 'I’ve saved the codes',
  включена: 'on',
  'резервных кодов осталось: {n}': 'backup codes left: {n}',
  'Код из приложения': 'Authenticator code',
  'Новые резервные коды': 'New backup codes',
  'Отключить защиту': 'Turn off',
  'QR-код для приложения': 'QR code for the app',
  '1. Отсканируйте QR-код в приложении-аутентификаторе.':
    '1. Scan the QR code in your authenticator app.',
  'Не получается — добавьте ключ вручную:': 'Can’t scan it? Add the key manually:',
  '2. Введите шесть цифр, которые покажет приложение.': '2. Enter the six digits the app shows.',
  Включить: 'Turn on',
  Настроить: 'Set up',
  // «Подтверждение сделок»: другая сторона сделки отвечает на заявку на восстановление
  'Подтверждение сделок': 'Deal confirmations',
  'Тот, с кем вы заключали сделки, восстанавливает доступ к аккаунту. Сверьте описание сделки из заявки с тем, что было, — ответ увидит только сотрудник.':
    'Someone you’ve had deals with is recovering their account. Compare the deal description from their request with what actually happened — only staff will see your answer.',
  'Просьб подтвердить сделку нет.': 'No requests to confirm a deal.',
  '@{username} восстанавливает доступ': '@{username} is recovering their account',
  'просьба от {date}': 'requested on {date}',
  'Ваши завершённые сделки': 'Your completed deals',
  'вы продавали': 'you sold',
  'вы покупали': 'you bought',
  'Описание из заявки': 'Description from the request',
  'Описание совпадает с тем, что было в сделке?': 'Does the description match what happened in the deal?',
  Совпадает: 'It matches',
  'Не совпадает': 'It doesn’t match',
  'Не помню': 'I don’t remember',
  'Ответ изменить нельзя. Если вас просят подтвердить в переписке или за вознаграждение, это повод ответить «Не совпадает».':
    'You can’t change your answer. If someone asks you to confirm in a chat or for a reward, that’s a reason to answer “It doesn’t match”.',
  'Спасибо: ответили, что описание совпадает.': 'Thank you: you answered that the description matches.',
  'Спасибо: ответили, что описание не совпадает.': 'Thank you: you answered that the description doesn’t match.',
  'Спасибо: ответили, что не помните.': 'Thank you: you answered that you don’t remember.',
  'Не удалось отправить ответ. Попробуйте ещё раз.': 'Couldn’t send your answer. Try again.',
  // «Почта» в «Безопасности»
  'Письмо со ссылкой ушло на {email}. Откройте его, чтобы подтвердить, — ссылка действует сутки.':
    'A link has been sent to {email}. Open it to confirm — the link works for a day.',
  'Не удалось сменить почту.': 'Couldn’t change the email.',
  'Почты у аккаунта нет — он заведён через сервис.': 'The account has no email — it was created through a service.',
  'На новую почту придёт ссылка для подтверждения, на прежнюю — письмо со ссылкой «Это не я»: 7 дней её можно вернуть.':
    'The new email will get a confirmation link, and the previous one a letter with an “It wasn’t me” link: it can be restored for 7 days.',
  'На почту придёт ссылка для подтверждения. С почтой можно входить по паролю и восстановить доступ.':
    'A confirmation link will be sent to the email. With an email you can sign in with a password and recover access.',
  'Сменить почту': 'Change email',
  'Добавить почту': 'Add email',
};
