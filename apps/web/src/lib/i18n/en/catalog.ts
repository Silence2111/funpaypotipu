/** Главная, каталог, указатель игр, раздел игры: таблица предложений, фильтры, пополнение, замер выдачи. */
export const CATALOG: Record<string, string> = {
  // Главная
  'Игровые товары. Безопасно.': 'Game goods. Safely.',
  '{n} игр и сервисов: аккаунты, валюта, предметы, ключи и донат.':
    '{n} games and services: accounts, currency, items, keys and top-ups.',
  'Аккаунты, валюта, предметы, ключи и донат.': 'Accounts, currency, items, keys and top-ups.',
  'Деньги лежат у площадки, пока вы не подтвердите, что получили товар.':
    'The marketplace holds the money until you confirm you’ve received the goods.',
  'Типы товаров': 'Product types',
  'Покупателю — без комиссии.': 'No fee for buyers.',
  'Продавцу — {fee}, вывод от {payout}.': 'Sellers pay {fee}, withdrawals from {payout}.',
  'Продать свой лот': 'Sell your item',
  'Это демо-стенд. Лоты с пометкой «Пример» — демонстрационные, а оплата проходит без списания денег: платёжный провайдер ещё не подключён.':
    'This is a demo site. Listings marked “Sample” are for demonstration, and payments go through without charging any money: the payment provider isn’t connected yet.',
  Популярные: 'Popular',
  'Новые предложения': 'New offers',
  'Все игры от А до Я': 'All games A to Z',
  Мобильные: 'Mobile',
  Приложения: 'Apps',
  'Как защищена сделка': 'How your deal is protected',
  'Деньги у площадки': 'The marketplace holds the money',
  'Продавец получит оплату, когда вы подтвердите получение или через {n} ч без спора.':
    'The seller gets paid when you confirm receipt, or after {n} h without a dispute.',
  'Продавец получит оплату, когда вы подтвердите получение.':
    'The seller gets paid when you confirm receipt.',
  'Спор с арбитром': 'Dispute with an arbiter',
  'Не получили или товар не как в описании — открываете спор, деньги замораживаются до решения.':
    'Didn’t receive it, or it’s not as described — open a dispute and the money is frozen until a decision.',
  'Ключи сразу': 'Keys instantly',
  'Ключи и пополнения выдаются автоматически после оплаты, а с каждой покупки — {pct} кэшбэка на баланс.':
    'Keys and top-ups are delivered automatically after payment, and every purchase earns {pct} cashback to your balance.',
  'Ключи и пополнения выдаются автоматически после оплаты.':
    'Keys and top-ups are delivered automatically after payment.',
  'Сколько это стоит': 'What it costs',
  'Ставки конкурентов сверены с их сайтами и справкой 26 сентября 2026 года.':
    'Competitor rates were checked against their websites and help pages on September 26, 2026.',
  'Комиссия продавца снижается за продажи, рейтинг и подтверждённые документы — до {n} процентных пунктов. Покупатель комиссию площадки не платит.':
    'The seller fee goes down with sales, rating and verified ID — by up to {n} percentage points. Buyers pay no marketplace fee.',
  'Комиссия продавца': 'Seller fee',
  'в среднем 9%, от 3%': 'average 9%, from 3%',
  '10% и 20%': '10% and 20%',
  'Вывод на карту и СБП': 'Withdrawal to card and SBP',
  '3%, минимум 30 ₽': '3%, minimum 30 ₽',
  '6%, минимум 60 ₽': '6%, minimum 60 ₽',
  'Вывод в USDT': 'Withdrawal in USDT',
  '4% плюс 1 $': '4% plus $1',
  'Кэшбэк покупателю': 'Buyer cashback',
  '{pct} деньгами': '{pct} in cash',
  нет: 'no',
  баллы: 'points',
  'Комиссия с покупателя': 'Buyer fee',

  // Поиск по предложениям
  'Все предложения — поиск игровых товаров': 'All offers — search game goods',
  'Поиск по предложениям продавцов: аккаунты, валюта, предметы, ключи, донат и услуги во всех играх.':
    'Search sellers’ offers: accounts, currency, items, keys, top-ups and services in every game.',
  'Сначала поднятые': 'Raised first',
  Дешевле: 'Cheapest first',
  Дороже: 'Priciest first',
  'Часто покупают': 'Popular',
  '{type} во всех играх': '{type} in all games',
  '{game}: поиск': '{game}: search',
  'Поиск: «{q}»': 'Search: “{q}”',
  'Все предложения': 'All offers',
  'Тип товара': 'Product type',
  'Все типы': 'All types',
  Игра: 'Game',
  'Продавец в сети': 'Seller online',
  'Цена снижена': 'Price dropped',
  'Идёт скидка или цена — самая низкая у лота за {n} дней':
    'On sale, or the lowest price this offer has had in {n} days',
  'Разделы: {game}': 'Categories: {game}',
  'Найдено: {n}': 'Found: {n}',
  'Ничего не нашлось. Попробуйте другие слова или уберите фильтры.':
    'Nothing found. Try other words or remove filters.',
  Сбросить: 'Reset',
  Страницы: 'Pages',
  Назад: 'Back',
  Дальше: 'Next',
  '{page} из {pages}': '{page} of {pages}',

  // Игры и разделы
  'Все игры': 'All games',
  'Все игры и сервисы от А до Я': 'All games and services A to Z',
  'Игры, мобильные игры и сервисы с разделами: аккаунты, валюта, предметы, ключи, донат и услуги.':
    'Games, mobile games and services with categories: accounts, currency, items, keys, top-ups and services.',
  '{n} — от А до Я, с разделами.': '{n} — A to Z, with categories.',
  'Что показать': 'What to show',
  Все: 'All',
  'Каталог пока собирается.': 'The catalog is still being put together.',
  'Игра не найдена': 'Game not found',
  '{game} — купить у продавцов': '{game} — buy from sellers',
  '{game}: {sections}. Деньги у площадки, пока вы не подтвердите получение.':
    '{game}: {sections}. The marketplace holds the money until you confirm receipt.',
  'предложения продавцов': 'sellers’ offers',
  'Разделов у игры пока нет.': 'This game has no categories yet.',
  'Раздел не найден': 'Category not found',
  '{category} {game} — купить у продавцов': '{game} {category} — buy from sellers',
  '{category} {game}: {offers} от продавцов с рейтингом и отзывами. Деньги у площадки, пока вы не подтвердите получение.':
    '{game} {category}: {offers} from sellers with ratings and reviews. The marketplace holds the money until you confirm receipt.',
  'Буквы указателя': 'Index letters',
  'На букву {letter}': 'Letter {letter}',
  '{n} в сети': '{n} online',
  'Продать в разделе': 'Sell in this category',
  'Разделы игры': 'Game categories',
  'Предложения: {category}': 'Offers: {category}',
  'По этим условиям предложений нет.': 'No offers match these filters.',
  'Сбросить фильтры': 'Reset filters',
  'В разделе «{category}» пока нет предложений. Выставьте своё — покупатели этого раздела увидят его первым.':
    'There are no offers in “{category}” yet. List yours — buyers in this category will see it first.',
  'Продать первым': 'Be the first to sell',

  // Фильтры раздела
  'Сначала дешёвые': 'Cheapest first',
  'Сначала дорогие': 'Priciest first',
  'Поиск по предложениям': 'Search offers',
  'Поиск по предложениям раздела': 'Search offers in this category',
  Фильтры: 'Filters',
  Сортировка: 'Sort',
  Показать: 'Show',

  // Таблица предложений
  Описание: 'Description',
  Продавец: 'Seller',
  Наличие: 'Stock',
  Цена: 'Price',
  'в наличии {qty}': '{qty} in stock',
  'выдача сразу': 'instant delivery',
  'Демонстрационный лот: показывает, как устроена сделка': 'Demo listing: shows how a deal works',
  Пример: 'Sample',
  продвижение: 'promoted',
  'нет отзывов': 'no reviews',

  // Поиск по играм
  'Поиск по {n} играм и сервисам': 'Search {n} games and services',
  Подсказки: 'Suggestions',
  'Игры с таким названием нет — поищем среди предложений.':
    'No game with that name — we’ll search the offers.',
  'Искать «{q}» в предложениях': 'Search offers for “{q}”',
  'Поиск лотов и игр…': 'Search listings and games…',
  Искать: 'Search',

  // Пополнение на сумму покупателя
  'На эту сумму предложений сейчас нет': 'No offers for this amount right now',
  'Не удалось оформить пополнение. Обновите страницу и попробуйте ещё раз.':
    'Couldn’t place the top-up. Refresh the page and try again.',
  'Сколько зачислить': 'Amount to credit',
  'Быстрый выбор суммы': 'Quick amount',
  'К оплате': 'To pay',
  '{sum} на {game} + наценка продавца {markup}': '{sum} to {game} + seller markup {markup}',
  '+ комиссия способа {fee}': '+ payment method fee {fee}',
  'Оформляем…': 'Placing the order…',
  'Оплатить {sum}': 'Pay {sum}',
  Оплатить: 'Pay',
  'Деньги у площадки, пока вы не подтвердите зачисление.':
    'The marketplace holds the money until you confirm the top-up arrived.',
  'Оплата демонстрационная, деньги не списываются.': 'This is a demo payment, no money is charged.',
  'Продавец {name}': 'Seller {name}',
  'условия лота': 'listing terms',
  'Пополнить {game}': 'Top up {game}',
  'Без пароля — нужен только логин': 'No password needed — just your login',

  // Пополнение баланса
  'Введите сумму в рублях, например 1000': 'Enter an amount in rubles, for example 1000',
  'Баланс пополнен на {sum}': 'Balance topped up by {sum}',
  'Не удалось пополнить. Попробуйте ещё раз.': 'Couldn’t top up. Please try again.',
  'Пополнить баланс, ₽': 'Top up balance, ₽',
  'Пополняем…': 'Topping up…',
  'Пополнить баланс': 'Top up balance',
  'На баланс придёт {sum}': '{sum} will be credited to your balance',

  // Как мы меряем выдачу
  'Открытый замер: сравниваем порядок выдачи GameMarket с правилами «дешевле сверху» и «по числу сделок продавца» на настоящих заказах.':
    'An open measurement: we compare GameMarket’s listing order with the rules “cheapest first” and “by seller deal count” on real orders.',
  'Комиссию берут не за список лотов, а за то, что первый лот окажется надёжным. Порядок выдачи стоит ровно столько, на сколько бьёт правило, которое вы примените сами: «дешевле сверху» или «у кого больше сделок».':
    'A fee isn’t paid for a list of listings — it’s paid for the first listing being reliable. The listing order is worth exactly as much as it beats a rule you’d apply yourself: “cheapest first” or “most deals first”.',
  'Сейчас каталог сортируется по поднятию и дате: наверху тот, кто последним нажал «поднять», потом самые свежие лоты. Надёжность продавца на место в выдаче не влияет, и мы не называем это умной выдачей.':
    'Right now the catalog is sorted by raise and date: on top is whoever last pressed “raise”, then the newest listings. Seller reliability doesn’t affect the position, and we don’t call this smart ranking.',
  'Замер сейчас недоступен: API не ответил.':
    'The measurement is unavailable right now: the API didn’t respond.',
  'заказов {total} · чистых {clean} · со спором или возвратом {problem}':
    'orders {total} · clean {clean} · with a dispute or refund {problem}',
  Правило: 'Rule',
  Согласованность: 'Concordance',
  Пар: 'Pairs',
  '— тривиальное': '— trivial',
  'Что именно считается': 'What exactly is measured',
  'Метрика — заказ без спора и возврата. Считаем долю пар «чистый ↔ проблемный» внутри одной категории, где правило поставило чистый выше. 0.5 — монетка, 1.0 — идеал.':
    'The metric is an order without a dispute or refund. We count the share of “clean ↔ problem” pairs within one category where the rule ranked the clean one higher. 0.5 is a coin toss, 1.0 is perfect.',
  'Продажи и рейтинг продавца — строго на момент заказа, без взгляда в будущее.':
    'Seller sales and rating are taken strictly as of the order, with no look into the future.',
  'Демонстрационные лоты в замер не входят: на придуманных данных выигрыш завышается на порядки.':
    'Demo listings are excluded: on made-up data the gain is inflated by orders of magnitude.',
  'Нужно по {talk} чистых и проблемных заказов, чтобы назвать направление, и по {claim} — чтобы утверждать разницу в 10 пунктов.':
    'We need {talk} clean and problem orders each to name a direction, and {claim} each to claim a 10-point difference.',

  // Сохранённый поиск в разделе
  'до {price}': 'up to {price}',
  '«{q}»': '“{q}”',
  'Убрать цену {price}': 'Remove price {price}',
  'Цена — целым числом рублей больше нуля.':
    'Enter the price as a whole number of rubles above zero.',
  'Не удалось сохранить поиск.': 'Couldn’t save the search.',
  'Поиск сохранён, уведомления включены': 'Search saved, notifications on',
  'Поиск сохранён': 'Search saved',
  'Сохранить поиск': 'Save search',
  'Все предложения раздела': 'All offers in this category',
  'Цена до, ₽': 'Price up to, ₽',
  'Без предела': 'No limit',
  'Уведомлять о новых предложениях': 'Notify me about new offers',
  'Новый подходящий лот придёт уведомлением — на сайте, в Telegram или пушем, как настроено в уведомлениях. О каждом лоте — один раз.':
    'A new matching listing will come as a notification — on the site, in Telegram or as a push, as set in your notification settings. Once per listing.',
};
