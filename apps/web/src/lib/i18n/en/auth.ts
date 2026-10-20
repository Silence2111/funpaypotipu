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
  'Почта подтверждена': 'Email confirmed',
  'Не удалось подтвердить': 'Couldn’t confirm',
  'Проверяем…': 'Checking…',
  'Спасибо, аккаунт подтверждён.': 'Thank you, your account is confirmed.',
  'В кабинет': 'Go to account',
};
