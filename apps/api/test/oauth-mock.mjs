/**
 * Тестовый сервер входа для e2e: ведёт себя как Google и VK ID. Проверяет
 * то же, что настоящие: ключ приложения, адрес возврата, state и PKCE
 * (S256) — код без верного code_verifier на токен не меняется.
 *
 * API для e2e запускается с OAUTH_TEST_ISSUER, указывающим сюда (только
 * вне прода). Кого «вернёт» сервис — задаёт сценарий: mock.as(provider, user).
 */
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

const CLIENTS = {
  google: { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET },
  vk: { id: process.env.VK_CLIENT_ID },
};

export function startOAuthMock(issuer) {
  const users = {};
  const codes = new Map();
  const tokens = new Map();
  const port = Number(new URL(issuer).port);

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  const form = (req) =>
    new Promise((done) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => done(Object.fromEntries(new URLSearchParams(raw))));
    });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, issuer);
    const [, provider, step] = url.pathname.split('/');
    const client = CLIENTS[provider];
    if (!client) return send(res, 404, { error: 'not_found' });

    if (step === 'authorize' && req.method === 'GET') {
      const q = url.searchParams;
      if (q.get('client_id') !== client.id) return send(res, 400, { error: 'invalid_client' });
      if (
        q.get('code_challenge_method') !== 'S256' ||
        !q.get('code_challenge') ||
        !q.get('state')
      ) {
        return send(res, 400, { error: 'invalid_request' });
      }
      const code = randomBytes(12).toString('hex');
      codes.set(code, {
        challenge: q.get('code_challenge'),
        redirect: q.get('redirect_uri'),
        user: users[provider],
      });
      const back = new URL(q.get('redirect_uri'));
      back.searchParams.set('code', code);
      back.searchParams.set('state', q.get('state'));
      if (provider === 'vk') back.searchParams.set('device_id', 'device-1');
      res.writeHead(302, { Location: back.toString() });
      return res.end();
    }

    if (step === 'token' && req.method === 'POST') {
      const f = await form(req);
      const saved = codes.get(f.code);
      codes.delete(f.code);
      const verifierOk =
        saved &&
        createHash('sha256')
          .update(f.code_verifier ?? '')
          .digest('base64url') === saved.challenge;
      const clientOk =
        f.client_id === client.id && (provider !== 'google' || f.client_secret === client.secret);
      if (!saved || !verifierOk || !clientOk || f.redirect_uri !== saved.redirect)
        return send(res, 400, { error: 'invalid_grant' });
      if (provider === 'vk' && f.device_id !== 'device-1')
        return send(res, 400, { error: 'invalid_device' });
      const token = randomBytes(12).toString('hex');
      tokens.set(token, saved.user);
      return send(res, 200, { access_token: token, token_type: 'Bearer', expires_in: 3600 });
    }

    if (step === 'userinfo') {
      if (provider === 'google') {
        const user = tokens.get((req.headers.authorization ?? '').replace(/^Bearer /, ''));
        return user ? send(res, 200, user) : send(res, 401, { error: 'invalid_token' });
      }
      const f = await form(req);
      const user = f.client_id === client.id ? tokens.get(f.access_token) : null;
      return user ? send(res, 200, { user }) : send(res, 401, { error: 'invalid_token' });
    }
    return send(res, 404, { error: 'not_found' });
  });

  return new Promise((ready) =>
    server.listen(port, () =>
      ready({
        as: (provider, user) => (users[provider] = user),
        close: () => server.close(),
      }),
    ),
  );
}
