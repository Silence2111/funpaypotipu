'use client';

import { clearSession } from './session';
import { disablePush } from './push';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Выход из аккаунта: пуши на это устройство выключаются, сеанс на сервере
 * закрывается, данные входа в браузере стираются. Раньше «Выйти» стирал
 * только данные в браузере: сеанс оставался открытым в списке сеансов, а
 * с пушами чужие уведомления продолжали бы приходить на это устройство.
 */
export async function logout(): Promise<void> {
  await disablePush().catch(() => undefined);
  await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' }).catch(
    () => undefined,
  );
  clearSession();
}
