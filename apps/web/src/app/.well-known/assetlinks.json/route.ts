import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

/**
 * Digital Asset Links для приложения в Google Play и RuStore (Trusted Web
 * Activity, apps/android): подтверждает, что приложение с этим пакетом и
 * этой подписью — наше, и Android открывает сайт в нём без адресной строки.
 * Без ANDROID_PACKAGE_NAME и ANDROID_CERT_SHA256 — 404: приложения нет.
 * Отпечатков может быть несколько через запятую: свой ключ загрузки и ключ
 * подписи Google Play.
 */
export function GET() {
  const pkg = process.env.ANDROID_PACKAGE_NAME?.trim();
  const prints = (process.env.ANDROID_CERT_SHA256 ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => FINGERPRINT.test(s));
  if (!pkg || !/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(pkg) || !prints.length) {
    return new NextResponse('Not found', { status: 404 });
  }
  return NextResponse.json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: prints },
    },
  ]);
}
