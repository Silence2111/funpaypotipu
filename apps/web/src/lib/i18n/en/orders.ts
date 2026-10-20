/** Заказ, отзыв о заказе, спор, сообщения. */
export const ORDERS: Record<string, string> = {
  // Статус заказа на его странице
  'Ждёт оплаты': 'Awaiting payment',
  'Оплачен, деньги у площадки': 'Paid, held by the marketplace',
  'Выдан, идёт проверка': 'Delivered, under review',
  Завершён: 'Completed',
  Спор: 'Dispute',
  'Деньги возвращены': 'Refunded',
  Отменён: 'Cancelled',
  'Истёк без оплаты': 'Expired unpaid',

  // Статус заказа в списках и в диалоге
  'ждёт оплаты': 'awaiting payment',
  оплачен: 'paid',
  выдан: 'delivered',
  завершён: 'completed',
  спор: 'dispute',
  возврат: 'refunded',
  отменён: 'cancelled',
  истёк: 'expired',

  // Этапы сделки
  Оплачен: 'Paid',
  Выдан: 'Delivered',
  Подтверждён: 'Confirmed',
  'Этапы сделки': 'Deal stages',
  'Защита сделки': 'Escrow protection',

  // Чем оплачено
  'Оплачено {method}': 'Paid {method}',
  'с баланса': 'from balance',
  'по СБП': 'via SBP',
  картой: 'by card',
  'через Apple Pay': 'via Apple Pay',
  'через Google Pay': 'via Google Pay',
  криптовалютой: 'with crypto',
  '{sum} с комиссией способа': '{sum} including the payment method fee',

  // Что происходит и что делать
  'Если не подтвердите и не откроете спор до {until}, заказ подтвердится сам.':
    'If you don’t confirm or open a dispute by {until}, the order will be confirmed automatically.',
  'Заказ создан, но не оплачен. Без оплаты он истечёт через 30 минут.':
    'The order has been created but not paid. Without payment it expires in 30 minutes.',
  'Оплата получена, ключ выдаётся. Обновите страницу через пару секунд.':
    'Payment received, your key is being delivered. Refresh the page in a couple of seconds.',
  'Оплата получена, товар выдаётся. Обновите страницу через пару секунд.':
    'Payment received, your item is being delivered. Refresh the page in a couple of seconds.',
  'Оплата получена, пополнение отправляется. Обновите страницу через пару секунд.':
    'Payment received, the top-up is being sent. Refresh the page in a couple of seconds.',
  'Оплата у площадки, продавец её не получит до вашего подтверждения. Ждём, когда он передаст товар; напишите ему в чат ниже. Не выдаст за 24 ч — деньги вернутся на баланс.':
    'The marketplace holds the payment; the seller won’t get it until you confirm. Waiting for the seller to hand over the goods — message them in the chat below. If they don’t deliver within 24 h, the money returns to your balance.',
  'Пополнение отправлено. Проверьте баланс и подтвердите зачисление — тогда продавец получит оплату. Не пришло — откройте спор.':
    'Top-up sent. Check your balance and confirm it arrived — then the seller gets paid. Didn’t arrive? Open a dispute.',
  'Товар выдан. Проверьте его и подтвердите получение — тогда продавец получит оплату.':
    'The goods have been delivered. Check them and confirm receipt — then the seller gets paid.',
  'Сделка закрыта: продавец получил оплату, кэшбэк зачислен на ваш баланс.':
    'Deal closed: the seller has been paid and cashback has been credited to your balance.',
  'Открыт спор. Деньги заморожены, пока арбитр не примет решение.':
    'A dispute is open. The money is frozen until the arbiter decides.',
  'Деньги вернулись на ваш баланс на площадке.':
    'The money has been returned to your marketplace balance.',
  'Покупатель оплатил, деньги у площадки. Передайте товар и нажмите «Отметить выдачу» — у вас 24 ч.':
    'The buyer has paid; the marketplace holds the money. Hand over the goods and press “Mark as delivered” — you have 24 h.',
  'Покупатель оплатил, деньги у площадки. Выдача идёт автоматически.':
    'The buyer has paid; the marketplace holds the money. Delivery is automatic.',
  'Вы отметили выдачу.': 'You marked the order as delivered.',
  'Выдано автоматически.': 'Delivered automatically.',
  'Деньги придут на баланс, когда покупатель подтвердит получение или истечёт срок проверки.':
    'The money will reach your balance when the buyer confirms receipt or the review period ends.',
  'Сделка закрыта, оплата зачислена на ваш баланс.':
    'Deal closed, payment credited to your balance.',
  'Покупатель открыл спор. Ответьте в споре и приложите доказательства передачи — или верните деньги сами.':
    'The buyer has opened a dispute. Reply in the dispute and attach proof of delivery — or refund the money yourself.',
  'Деньги вернулись покупателю на баланс. Сделка закрыта.':
    'The money has been returned to the buyer’s balance. Deal closed.',

  // Страница заказа
  Заказ: 'Order',
  'Заказ {n} · вы покупатель': 'Order {n} · you’re the buyer',
  'Заказ {n} · вы продавец': 'Order {n} · you’re the seller',
  'Загружаем заказ': 'Loading the order',
  'Заказ не найден': 'Order not found',
  'Заказ не найден или он не ваш.': 'Order not found, or it isn’t yours.',
  'Заказ виден только его участникам. Войдите, чтобы открыть его.':
    'Only the participants can see this order. Sign in to open it.',
  'Не получилось. Обновите страницу — возможно, статус заказа уже изменился.':
    'That didn’t work. Refresh the page — the order status may have changed.',
  'Оплата не прошла. Выберите другой способ или попробуйте ещё раз.':
    'Payment failed. Choose another method or try again.',
  'Оплата не прошла. Заказ создан — выберите способ ниже и попробуйте ещё раз.':
    'Payment failed. The order has been created — choose a method below and try again.',
  'Зачисление {sum} на аккаунт': 'Crediting {sum} to the account',
  'Пополнение на аккаунт': 'Top-up to the account',
  'Отметить выдачу': 'Mark as delivered',
  'Показать товар': 'Show item',
  'Показать ключи': 'Show keys',
  'Показать ключ': 'Show key',
  'Ключ ещё не выдан': 'The key hasn’t been delivered yet',
  'Ваш товар · {n} шт.': 'Your item · {n} pcs',
  'Ваш товар': 'Your item',
  'Ваши ключи · {n}': 'Your keys · {n}',
  'Ваш ключ': 'Your key',
  'Всё получил, подтвердить': 'Got everything, confirm',
  'Отменить заказ? Деньги вернутся на ваш баланс.':
    'Cancel the order? The money will return to your balance.',
  'Отменить заказ': 'Cancel order',
  'Вернуть деньги покупателю': 'Refund the buyer',
  'Вернуть всю сумму покупателю на баланс? Отменить возврат будет нельзя.':
    'Refund the full amount to the buyer’s balance? The refund can’t be undone.',
  'Причину увидит покупатель — можно оставить пустой.':
    'The buyer will see the reason — you can leave it empty.',
  'Не удалось вернуть деньги. Обновите страницу — возможно, статус заказа уже изменился.':
    'Couldn’t refund the money. Refresh the page — the order status may have changed.',
  'Открыть спор': 'Open a dispute',
  'Что пошло не так': 'What went wrong',
  'Опишите проблему: что не так с товаром или передачей':
    'Describe the problem: what’s wrong with the goods or the handover',
  'Например: пароль не подходит, аккаунт не соответствует описанию':
    'For example: the password doesn’t work, the account doesn’t match the description',
  'Например: ключ уже активирован, пишет «код использован»':
    'For example: the key is already activated, it says “code used”',
  'Спор рассмотрит арбитр площадки. Деньги заморожены до решения.':
    'A marketplace arbiter will review the dispute. The money is frozen until the decision.',
  'Не удалось открыть спор. Попробуйте ещё раз.': 'Couldn’t open the dispute. Try again.',
  'Не сейчас': 'Not now',
  'Перейти к спору': 'Go to the dispute',
  'Вопрос не к продавцу, а к площадке?': 'A question for the marketplace, not the seller?',
  'Чат по сделке': 'Deal chat',
  'Чат откроется, когда заказ будет оплачен. Всё, что написано в нём, увидит арбитр при споре.':
    'The chat opens once the order is paid. The arbiter will see everything in it if there’s a dispute.',

  // Отзыв о заказе
  'Покупатель ещё не оставил отзыв.': 'The buyer hasn’t left a review yet.',
  'Оцените продавца': 'Rate the seller',
  'Изменить отзыв': 'Edit review',
  'Что понравилось, что нет — необязательно': 'What you liked and what you didn’t — optional',
  'Поставьте оценку': 'Choose a rating',
  'Не удалось сохранить отзыв.': 'Couldn’t save the review.',
  'Оставить отзыв': 'Leave a review',
  'Ваш отзыв': 'Your review',
  'Отзыв покупателя': 'Buyer’s review',
  'Удалить отзыв? Рейтинг продавца пересчитается без него.':
    'Delete the review? The seller’s rating will be recalculated without it.',
  'Не удалось удалить отзыв.': 'Couldn’t delete the review.',
  'Можно до {date}': 'Available until {date}',
  'Ответить на отзыв': 'Reply to the review',

  // Спор
  'ждёт арбитра': 'waiting for an arbiter',
  'на рассмотрении у арбитра': 'under review by an arbiter',
  'решён в пользу продавца': 'resolved in the seller’s favor',
  'решён в пользу покупателя': 'resolved in the buyer’s favor',
  закрыт: 'closed',
  'Спор по заказу': 'Order dispute',
  'Спор недоступен': 'The dispute is unavailable',
  'Войдите, чтобы открыть спор.': 'Sign in to open the dispute.',
  'К заказу': 'Back to the order',
  Вы: 'You',
  Покупатель: 'Buyer',
  Арбитр: 'Arbiter',
  'Покупатель {buyer} · продавец {seller}': 'Buyer {buyer} · seller {seller}',
  'арбитр {name}': 'arbiter {name}',
  'Причина спора': 'Reason for the dispute',
  'Комментарий арбитра:': 'Arbiter’s comment:',
  'Решение арбитра': 'Arbiter’s decision',
  'Взять в работу': 'Take on',
  'Не удалось взять спор': 'Couldn’t take the dispute',
  'Отдать деньги продавцу': 'Release to the seller',
  'Решение: вернуть деньги покупателю. Отменить его будет нельзя.':
    'Decision: refund the buyer. It can’t be undone.',
  'Решение: отдать деньги продавцу. Отменить его будет нельзя.':
    'Decision: release the money to the seller. It can’t be undone.',
  'Комментарий для сторон:': 'Comment for both parties:',
  'Не удалось принять решение': 'Couldn’t record the decision',
  'Деньги сразу уходят выбранной стороне, стороны получат уведомление.':
    'The money goes to the chosen party right away; both parties will be notified.',
  'заметка, стороны её не видят': 'note, hidden from the parties',
  доказательство: 'evidence',
  'Файл-доказательство': 'Evidence file',
  'Прикрепить доказательство': 'Attach evidence',
  'Сообщений пока нет. Опишите ситуацию и приложите доказательства.':
    'No messages yet. Describe the situation and attach evidence.',
  'Сообщение сторонам…': 'Message to the parties…',
  'Сообщение арбитру и второй стороне…': 'Message to the arbiter and the other party…',
  'Заметка для сотрудников — стороны её не увидят': 'Staff note — the parties won’t see it',
  'Не удалось отправить': 'Couldn’t send',
  'Файл отклонён (антивирус) или хранилище недоступно':
    'File rejected (antivirus) or storage is unavailable',

  // Сообщения
  'Войдите, чтобы открыть переписку с продавцами и покупателями.':
    'Sign in to open your conversations with sellers and buyers.',
  'Выберите диалог слева. Написать продавцу можно со страницы любого лота.':
    'Choose a conversation on the left. You can message a seller from any listing page.',
  'Поиск по имени или заказу': 'Search by name or order',
  'Поиск по диалогам': 'Search conversations',
  Диалоги: 'Conversations',
  'Все диалоги': 'All conversations',
  'Никого не нашлось.': 'No one found.',
  'Диалогов пока нет. Напишите продавцу со страницы лота — переписка появится здесь.':
    'No conversations yet. Message a seller from a listing page — the conversation will appear here.',
  'Покупка {n}': 'Purchase {n}',
  'Продажа {n}': 'Sale {n}',
  'До покупки': 'Before purchase',
  'Вы:': 'You:',
  'Сообщений пока нет': 'No messages yet',
  'Непрочитанных: {n}': 'Unread: {n}',
  'Диалог не открылся. Обновите страницу.': 'The conversation didn’t open. Refresh the page.',
  'Файл не отправлен: хранилище недоступно или файл не прошёл проверку.':
    'File not sent: storage is unavailable or the file didn’t pass the check.',
  'печатает…': 'typing…',
  'Показать раньше': 'Show earlier',
  'Сообщений пока нет. Всё, что написано здесь, увидит арбитр при споре.':
    'No messages yet. The arbiter will see everything written here if there’s a dispute.',
  вложение: 'attachment',
  Вложение: 'Attachment',
  прочитано: 'read',
  доставлено: 'delivered',
  'Прикрепить файл': 'Attach a file',
  'Переподключение… сообщение уйдёт через сайт':
    'Reconnecting… the message will be sent via the site',
  вчера: 'yesterday',
  Сегодня: 'Today',
  Вчера: 'Yesterday',

  // Системные сообщения сделки (их пишет API)
  'Заказ создан. Обсудите детали и дождитесь оплаты.':
    'Order created. Discuss the details and wait for payment.',
  'Пришла ещё одна оплата, когда заказ уже был оплачен или закрыт, — она зачислена на баланс покупателя.':
    'Another payment arrived after the order was already paid or closed — it has been credited to the buyer’s balance.',
  'Оплата поступила — средства защищены эскроу.':
    'Payment received — the funds are protected by escrow.',
  'Пополнение отправлено. Проверьте баланс и подтвердите получение.':
    'Top-up sent. Check your balance and confirm receipt.',
  'Товар выдан автоматически — он на странице заказа. Проверьте его и подтвердите получение.':
    'The item was delivered automatically — it’s on the order page. Check it and confirm receipt.',
  'Товар выдан автоматически. Заберите ключ на странице заказа.':
    'Delivered automatically. Get your key on the order page.',
  'Провайдер не принял пополнение — деньги вернулись на баланс покупателя.':
    'The provider didn’t accept the top-up — the money has been returned to the buyer’s balance.',
  'Товара не оказалось на складе — деньги вернулись на баланс покупателя.':
    'The item was out of stock — the money has been returned to the buyer’s balance.',
  'Пока шла оплата, товар закончился — деньги вернулись на баланс покупателя.':
    'The item sold out while the payment was processing — the money has been returned to the buyer’s balance.',
  'Продавец отметил выдачу. Проверьте товар и подтвердите получение.':
    'The seller marked the order as delivered. Check the goods and confirm receipt.',
  'Срок проверки истёк — заказ подтверждён автоматически. Средства переданы продавцу.':
    'The review period has ended — the order was confirmed automatically. The funds have been released to the seller.',
  'Покупатель подтвердил получение. Сделка завершена, средства переданы продавцу.':
    'The buyer confirmed receipt. Deal completed, the funds have been released to the seller.',
  'Заказ отменён до оплаты.': 'Order cancelled before payment.',
  'Заказ отменён, средства возвращены покупателю на баланс.':
    'Order cancelled, the funds have been returned to the buyer’s balance.',
  'Продавец вернул деньги покупателю на баланс.':
    'The seller refunded the money to the buyer’s balance.',
  'Продавец не выдал товар в срок — заказ отменён автоматически, средства возвращены покупателю.':
    'The seller didn’t deliver in time — the order was cancelled automatically and the funds returned to the buyer.',
  'Открыт спор. К обсуждению подключится арбитр площадки.':
    'A dispute has been opened. A marketplace arbiter will join the conversation.',
  'Спор решён в пользу продавца. Средства переданы продавцу.':
    'The dispute was resolved in the seller’s favor. The funds have been released to the seller.',
  'Спор решён в пользу покупателя. Средства возвращены покупателю.':
    'The dispute was resolved in the buyer’s favor. The funds have been returned to the buyer.',
  'Вопрос о лоте «{title}»': 'Question about the listing “{title}”',
  'Количество: {qty}.': 'Quantity: {qty}.',
  'Причина: {reason}': 'Reason: {reason}',
  'Проверяем оплату — обычно это несколько секунд. Страница обновится сама.':
    'Checking your payment — this usually takes a few seconds. The page will update by itself.',
  'Банк ещё не подтвердил оплату. Если деньги списаны, заказ оплатится сам, как только подтверждение придёт. Если нет — выберите способ ниже и оплатите снова.':
    'The bank hasn’t confirmed the payment yet. If the money was charged, the order will be paid as soon as the confirmation arrives. If not, choose a method below and pay again.',
};
