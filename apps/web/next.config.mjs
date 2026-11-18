import { existsSync } from 'node:fs';

/**
 * Юрдокументы (оферта, политика, согласия, форма обращения) собирает общая система
 * ~/Projects/_система/юр. На сервере их отдаёт Caddy (infra/Caddyfile), на стенде —
 * этот сайт, если их положил `bash infra/ops/yur.sh --local` в public/yur (папка в .gitignore).
 * Нет файлов — работают запасные страницы сайта.
 */
const YUR = existsSync(new URL('./public/yur/oferta/index.html', import.meta.url));
const YUR_PATHS = ['privacy', 'oferta', 'soglasie', 'soglasie-rasprostranenie', 'obrashchenie', 'obrashchenie/soglasie'];

/**
 * Заголовки безопасности для всех страниц. CSP — только то, что не ломает
 * встроенные скрипты Next и виджет Telegram: сайт нельзя встроить в чужую
 * страницу (кликджекинг), подменить base и плагины, отправить форму на
 * чужой адрес. HSTS — только в боевой сборке: на localhost он ни к чему.
 */
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Камера — для фото документов в проверке личности; микрофон и место не нужны.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Плавающий значок Next в углу попадал на скриншоты и показ
  devIndicators: false,
  poweredByHeader: false,
  transpilePackages: ['@gamemarket/shared'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async rewrites() {
    if (!YUR) return [];
    const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
    return {
      beforeFiles: [
        ...YUR_PATHS.map((p) => ({ source: `/${p}`, destination: `/yur/${p}/index.html` })),
        { source: '/obrashchenie/otpravit', destination: `${api}/api/obrashchenie/otpravit` },
      ],
    };
  },
};

export default nextConfig;
