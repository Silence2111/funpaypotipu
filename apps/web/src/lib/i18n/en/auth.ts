/** Вход, регистрация, восстановление пароля, вход через сервисы. */
export const AUTH: Record<string, string> = {
  // Вход и регистрация
  Вход: 'Sign in',
  'Создать аккаунт': 'Create account',
  'Аккаунт продавца': 'Seller account',
  'Один аккаунт и для покупок, и для продаж. После регистрации сразу откроется форма лота.':
    'One account for buying and selling. After sign-up, the listing form opens right away.',
  'Бесплатно. Один аккаунт — и покупать, и продавать.': 'Free. One account to buy and sell.',
  'Войдите, чтобы купить, продать или открыть заказ.': 'Sign in to buy, sell or open an order.',
  Почта: 'Email',
  'name@mail.ru': 'name@example.com',
  'Введите почту': 'Enter your email',
  'Нужен вид name@mail.ru': 'Use the format name@example.com',
  'Имя в профиле': 'Profile name',
  'Например, nightfox': 'For example, nightfox',
  'Имя в профиле — от 3 символов, его увидят продавцы и покупатели':
    'Profile name must be at least 3 characters — sellers and buyers will see it',
  'Строчные латинские буквы, цифры и _, от 3 символов':
    'Lowercase Latin letters, digits and _, at least 3 characters',
  Пароль: 'Password',
  'Придумайте пароль': 'Create a password',
  'Введите пароль': 'Enter your password',
  'Пароль — не короче 8 символов': 'Password must be at least 8 characters',
  'Не короче 8 символов': 'At least 8 characters',
  'Мне есть 18 лет, я принимаю': 'I’m 18 or older, I accept the',
  правила: 'rules',
  оферту: 'terms of service',
  'и согласен на': 'and agree to the',
  'обработку персональных данных': 'processing of personal data',
  'Без согласия с правилами аккаунт не создать':
    'You can’t create an account without accepting the rules',
  'Создаём аккаунт…': 'Creating account…',
  'Входим…': 'Signing in…',
  'Не удалось создать аккаунт. Попробуйте ещё раз.': 'Couldn’t create the account. Try again.',
  'Не получилось войти. Попробуйте ещё раз.': 'Couldn’t sign in. Try again.',
  'Почта или пароль не подошли. Проверьте раскладку и попробуйте ещё раз.':
    'Email or password is incorrect. Check your keyboard layout and try again.',
  'Уже есть аккаунт?': 'Already have an account?',
  'Нет аккаунта?': 'No account?',
  Создать: 'Sign up',
  'Забыли пароль?': 'Forgot your password?',

  // Код из приложения
  'Код из приложения': 'Authenticator code',
  'Код из приложения-аутентификатора': 'Code from your authenticator app',
  'Резервный код': 'Backup code',
  'Введите код из приложения': 'Enter the authenticator code',
  'Введите резервный код': 'Enter a backup code',
  'Каждый резервный код работает один раз.': 'Each backup code works once.',
  'Шесть цифр из Google Authenticator, 1Password или похожего.':
    'Six digits from Google Authenticator, 1Password or a similar app.',
  'Ввести код из приложения': 'Enter an authenticator code',
  'Нет телефона — ввести резервный код': 'No phone — enter a backup code',
  '← Другая почта или пароль': '← Different email or password',
  'У аккаунта включена двухфакторная защита — она действует и при входе через сервис.':
    'Two-factor protection is on for this account — it also applies when you sign in with a service.',

  // Вход через сервисы
  или: 'or',
  'Войти через VK ID': 'Sign in with VK ID',
  'Войти через Google': 'Sign in with Google',
  'Telegram не подтвердил вход. Попробуйте ещё раз.': 'Telegram didn’t confirm sign-in. Try again.',
  'Вход через сервис занял больше 10 минут. Начните заново.':
    'Signing in with the service took more than 10 minutes. Start again.',
  'Вход начали в другой вкладке или браузере. Начните заново здесь.':
    'Sign-in was started in another tab or browser. Start again here.',
  'Вход отменён в сервисе.': 'Sign-in was cancelled in the service.',
  'Сервис не подтвердил вход. Попробуйте ещё раз или войдите по почте.':
    'The service didn’t confirm sign-in. Try again or sign in with email.',
  'Сервис не ответил. Попробуйте ещё раз или войдите по почте.':
    'The service didn’t respond. Try again or sign in with email.',
  'Этот способ входа сейчас недоступен.': 'This sign-in method is unavailable right now.',
  сервис: 'a service',
  'Почти готово': 'Almost done',
  '{name}, вы входите через {via} впервые.':
    '{name}, you’re signing in with {via} for the first time.',
  'Вы входите через {via} впервые.': 'You’re signing in with {via} for the first time.',
  'Выберите ник — по нему вас найдут покупатели и продавцы, сменить его потом нельзя.':
    'Choose a username — buyers and sellers will find you by it, and it can’t be changed later.',
  Ник: 'Username',
  'Ник — строчные латинские буквы, цифры и _, от 3 символов':
    'Username: lowercase Latin letters, digits and _, at least 3 characters',
  'Ник занят': 'Username is taken',
  'Ник занят — например, свободен {name}': 'Username is taken — {name} is available, for example',
  'Вход не завершён. Начните заново.': 'Sign-in wasn’t completed. Start again.',
  'Ко входу': 'Back to sign in',

  // Пароль и почта
  'Восстановление пароля': 'Password recovery',
  'Если такой e-mail зарегистрирован, мы отправили на него ссылку для сброса пароля (действует 1 час).':
    'If this email is registered, we’ve sent a password reset link to it (valid for 1 hour).',
  'Отправить ссылку': 'Send link',
  '← Ко входу': '← Back to sign in',
  'Новый пароль': 'New password',
  'Нет токена в ссылке': 'The link has no token',
  'Ссылка недействительна или истекла': 'The link is invalid or has expired',
  'Ссылка недействительна или истекла.': 'The link is invalid or has expired.',
  'Пароль обновлён. Перенаправляем ко входу…': 'Password updated. Taking you to sign in…',
  'Сохранить пароль': 'Save password',
  // «Это не я» из письма «Пароль изменён»
  'Восстановить доступ': 'Restore access',
  'Пароль сменили не вы? Задайте новый: все устройства, где выполнен вход, выйдут из аккаунта.':
    'Didn’t change your password? Set a new one: every device that’s signed in will be signed out.',
  'Доступ восстановлен: пароль новый, все устройства вышли из аккаунта.':
    'Access restored: the password is new, and all devices have been signed out.',
  'Войти с новым паролем': 'Sign in with the new password',
  'Запросить новую ссылку': 'Request a new link',
  // «Не могу войти»: заявка в поддержку без входа
  'Не могу войти': 'Can’t sign in',
  'Вход с кодом включил не я': 'Someone else turned on the sign-in code',
  'Пароль сменили, а потом включили вход с кодом — «Это не я» из писем не помогает':
    'The password was changed and then the sign-in code was turned on — “It wasn’t me” from the emails doesn’t help',
  'Пароль сменил не я': 'Someone else changed the password',
  'Ссылка «Это не я» из письма истекла или не пришла':
    'The “It wasn’t me” link in the email expired or never arrived',
  Другое: 'Other',
  'Опишите, что случилось': 'Describe what happened',
  'Опишите, что случилось, — от 10 символов': 'Describe what happened — at least 10 characters',
  'Не больше трёх номеров заказов': 'No more than three order numbers',
  'Не удалось отправить заявку. Попробуйте ещё раз.': 'Couldn’t send the request. Try again.',
  'Заявка принята.': 'Request received.',
  'Если аккаунт с такой почтой есть, сотрудник проверит, что он ваш, и ответит на почту аккаунта. Решение — не раньше чем через 3 дня: за это время владелец аккаунта увидит заявку и сможет сказать, что подавал её не он.':
    'If an account with this email exists, staff will check that it’s yours and reply to the account’s email. The decision takes at least 3 days: in that time the account owner will see the request and can say they didn’t file it.',
  'Когда «Это не я» из писем не помогло. Сотрудник сверит заявку с историей аккаунта: сделки, входы, смены пароля.':
    'For when “It wasn’t me” from the emails didn’t help. Staff will check the request against the account’s history: deals, sign-ins, password changes.',
  'Почта аккаунта': 'Account email',
  'Что случилось': 'What happened',
  'Номера заказов — необязательно': 'Order numbers — optional',
  'До трёх, через запятую. Подтверждают, что сделки — ваши.':
    'Up to three, separated by commas. They confirm the deals are yours.',
  Подробности: 'Details',
  'Когда перестали входить, что пришло на почту, с чего обычно входите':
    'When you stopped being able to sign in, what arrived by email, what you usually sign in from',
  'Отправить заявку': 'Send request',
  'Не помните тот пароль? Заявка в поддержку': 'Don’t remember that password? Ask support',
  // Нет доступа и к почте аккаунта: новая почта и документы по ссылке
  'Укажите почту, на которую ответить': 'Enter the email to reply to',
  'Если аккаунт с такой почтой есть, сотрудник напишет на новую почту: попросит заплатить 1 ₽ картой, которой вы платили, селфи с документом или описать сделки. Решение — не раньше чем через 3 дня.':
    'If an account with this email exists, staff will write to the new email and ask you to pay 1 ₽ with a card you’ve paid with, send a selfie with your ID, or describe your deals. The decision takes at least 3 days.',
  'Нет доступа и к почте аккаунта': 'I can’t access the account email either',
  'Сотрудник напишет на новую почту и попросит подтвердить, что аккаунт ваш: картой, которой вы платили, селфи с документом, если проверка личности пройдена, или описанием сделок.':
    'Staff will write to the new email and ask you to prove the account is yours: with a card you’ve paid with, a selfie with your ID if the account has passed the ID check, or a description of your deals.',
  'Новая почта для связи': 'New email for contact',
  'Если сотрудник подтвердит, что аккаунт ваш, она станет почтой аккаунта.':
    'If staff confirm the account is yours, it becomes the account email.',
  'Документы для восстановления доступа': 'Documents for account recovery',
  'Ссылка действует неделю и только последняя из присланных. Если заявку уже решили, ответ пришёл на почту.':
    'The link works for a week, and only the latest one sent. If the request has been decided, the answer came by email.',
  'Подать заявку заново': 'File a new request',
  'Документы отправлены. Сотрудник сверит их с проверкой личности и ответит на эту почту.':
    'Documents sent. Staff will compare them with the ID check and reply to this email.',
  'Сфотографируйте тот же документ, что при проверке личности, и сделайте селфи с ним. Сотрудник сверит их и решит, вернуть ли вам аккаунт.':
    'Take a photo of the same document as in your ID check and a selfie with it. Staff will compare them and decide whether to return the account to you.',
  'Отправить документы': 'Send documents',
  // «Опишите сделки» — без проверки личности, по ссылке на новую почту
  'Сделки для восстановления доступа': 'Deals for account recovery',
  'Описание отправлено. Участники сделок сверят его, а сотрудник ответит на эту почту — не раньше чем через 3 дня после заявки.':
    'Description sent. The other parties will check it, and staff will reply to this email no sooner than 3 days after the request.',
  'Проверки личности у аккаунта нет, поэтому вспомните две-три сделки с разными продавцами или покупателями. Мы спросим их, совпадает ли описание, — ответ увидит только сотрудник. Нужны подтверждения хотя бы двух.':
    'The account has no ID check, so recall two or three deals with different sellers or buyers. We’ll ask them whether your description matches — only staff will see their answers. At least two confirmations are needed.',
  'Сделка {n}': 'Deal {n}',
  'Сделка {n} — необязательно': 'Deal {n} — optional',
  'Ник продавца или покупателя': 'Seller’s or buyer’s username',
  'Что было в сделке': 'What the deal was',
  'Что покупали или продавали, когда, о чём договаривались в чате':
    'What you bought or sold, when, and what you agreed on in the chat',
  'Пишите то, что помнят только участники сделки: детали из переписки, как и когда выдали товар. Номера заказов не нужны.':
    'Write what only the people in the deal would remember: details from the chat, how and when the item was delivered. Order numbers aren’t needed.',
  'Отправить описание': 'Send description',
  'Опишите хотя бы две сделки': 'Describe at least two deals',
  'Опишите сделку подробнее — от 20 символов': 'Describe the deal in more detail — at least 20 characters',
  'Не удалось отправить описание. Попробуйте ещё раз.': 'Couldn’t send the description. Try again.',
  // «Проверка картой» — 1 ₽ блокируется и сразу снимается
  'Проверка картой': 'Card check',
  'Готово: блокировка 1 ₽ снята. Сотрудник сверит карту и ответит на эту почту — не раньше чем через 3 дня после заявки.':
    'Done: the 1 ₽ hold has been released. Staff will check the card and reply to this email no sooner than 3 days after the request.',
  'Ждём ответа банка…': 'Waiting for the bank…',
  'Заплатите 1 ₽ картой, которой вы платили на GameMarket или на которую выводили деньги. Сумма только заблокируется на карте и сразу вернётся, а мы сверим первые 6 и последние 4 цифры с прошлыми оплатами.':
    'Pay 1 ₽ with a card you’ve paid with on GameMarket or withdrawn money to. The amount is only put on hold and released right away, and we’ll compare the first 6 and last 4 digits with your past payments.',
  'Оплата не прошла. Попробуйте ещё раз — той же картой или другой, которой платили на GameMarket.':
    'The payment didn’t go through. Try again — with the same card or another one you’ve paid with on GameMarket.',
  'Заплатить 1 ₽ картой': 'Pay 1 ₽ by card',
  'Номер карты вводится на странице ЮKassa — площадка его не видит и не хранит.':
    'You enter the card number on the YooKassa page — the marketplace neither sees nor stores it.',
  'Не удалось перейти к оплате. Попробуйте ещё раз.': 'Couldn’t go to the payment page. Try again.',
  // «Это не я» из письма «Вход с кодом из приложения включён»
  'Выключить вход с кодом': 'Turn off the sign-in code',
  'Вход с кодом из приложения включили не вы? Введите пароль, который был у аккаунта в тот момент, и задайте новый.':
    'Didn’t turn on the sign-in code? Enter the password the account had at that moment and set a new one.',
  'Пароль на момент включения': 'Password at that moment',
  'От 8 символов. Все устройства выйдут из аккаунта.':
    'At least 8 characters. All devices will be signed out.',
  'Выключить и сменить пароль': 'Turn off and change password',
  'Вход с кодом выключен, пароль новый, все устройства вышли из аккаунта.':
    'The sign-in code is off, the password is new, and all devices have been signed out.',
  'Почта подтверждена': 'Email confirmed',
  'Не удалось подтвердить': 'Couldn’t confirm',
  'Проверяем…': 'Checking…',
  'Спасибо, аккаунт подтверждён.': 'Thank you, your account is confirmed.',
  'В кабинет': 'Go to account',
  // Смена почты: ссылка на новую почту и «Это не я» со старой
  'Новая почта': 'New email',
  'Готово: почта аккаунта — {email}. Входите с ней и тем же паролем.':
    'Done: the account email is now {email}. Sign in with it and the same password.',
  'В «Безопасность»': 'Go to Security',
  'Ссылка действует сутки и только последняя из присланных. Попросите новую в «Безопасности».':
    'The link works for a day, and only the latest one sent. Request a new one in Security.',
  'Не удалось вернуть почту. Попробуйте ещё раз.': 'Couldn’t restore the email. Try again.',
  'Вернуть прежнюю почту': 'Restore the previous email',
  'Почта аккаунта снова {email}. Все устройства вышли, вход с кодом и входы через сервисы отключены.':
    'The account email is {email} again. All devices were signed out, and the sign-in code and service sign-ins were turned off.',
  'Вернуть почту можно 7 дней после смены и только до следующей смены. Если доступа к аккаунту нет — «Не могу войти».':
    'The email can be restored for 7 days after the change, and only until the next change. If you can’t access the account, use “I can’t sign in”.',
  'Почту аккаунта сменили на {email}. Если это сделали не вы — верните прежнюю до {until}: задайте новый пароль, все устройства выйдут, вход с кодом и входы через сервисы отключатся.':
    'The account email was changed to {email}. If it wasn’t you, restore the previous one by {until}: set a new password, and all devices will be signed out, with the sign-in code and service sign-ins turned off.',
  'Вернуть почту': 'Restore email',
};
