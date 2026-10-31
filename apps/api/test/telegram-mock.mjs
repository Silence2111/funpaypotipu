/**
 * Тестовый сервер Bot API для e2e: принимает sendMessage, editMessageText и
 * answerCallbackQuery от бота, отвечает как Telegram (номер сообщения — свой
 * в каждом чате) и запоминает вызовы, чтобы сценарий видел, что ушло
 * пользователю. API для e2e запускается с TELEGRAM_API_URL, указывающим сюда
 * (только вне прода).
 */
import { createServer } from 'node:http';

export function startTelegramMock(port, token) {
  const calls = [];
  const counters = new Map();
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url ?? '');
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (!m || m[1] !== token)
      return send(404, { ok: false, error_code: 404, description: 'Not Found' });
    let body = {};
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      return send(400, { ok: false, error_code: 400 });
    }
    let result = true;
    if (m[2] === 'sendMessage') {
      const chat = String(body.chat_id);
      const n = (counters.get(chat) ?? 0) + 1;
      counters.set(chat, n);
      result = { message_id: n, chat: { id: body.chat_id }, text: body.text };
    }
    if (m[2] === 'editMessageText') result = { message_id: body.message_id, text: body.text };
    calls.push({ method: m[2], body, result });
    return send(200, { ok: true, result });
  });
  return new Promise((resolve) =>
    server.listen(port, () =>
      resolve({
        calls,
        /** Вызовы бота в этот чат; у sendMessage в result — номер сообщения. */
        to: (chat) => calls.filter((c) => String(c.body.chat_id) === String(chat)),
        close: () => server.close(),
      }),
    ),
  );
}
