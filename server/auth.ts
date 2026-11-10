/**
 * Вход по одному паролю из окружения. Сессия — токен `<срок>.<HMAC-SHA256>` без хранения на сервере.
 * Пароль сравнивается за постоянное время; не больше 5 ошибок с одного IP за 10 минут.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface Auth {
  enabled: boolean;
  login(password: string, ip: string): { ok: true; token: string } | { ok: false; status: 401 | 429 | 403 };
  verify(token: string | undefined): boolean;
}

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FAIL_WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILS = 5;
const TOKEN_PREFIX = 'wtv1.';

export function createAuth(opts: { password: string | undefined; secret?: string; now?: () => number }): Auth {
  const password = opts.password ?? '';
  const enabled = password.trim().length > 0;
  const secret = opts.secret && opts.secret.length > 0 ? opts.secret : randomBytes(32).toString('hex');
  const now = opts.now ?? Date.now;
  const fails = new Map<string, number[]>();

  const mac = (data: string) => createHmac('sha256', secret).update(data).digest();
  const passwordMac = mac(`password:${password}`);

  function recentFails(ip: string, t: number): number[] {
    for (const [key, times] of fails) {
      const alive = times.filter((x) => t - x < FAIL_WINDOW_MS);
      if (alive.length === 0) fails.delete(key);
      else fails.set(key, alive);
    }
    return fails.get(ip) ?? [];
  }

  function sign(exp: number): string {
    return mac(TOKEN_PREFIX + exp).toString('base64url');
  }

  return {
    enabled,

    login(attempt, ip) {
      if (!enabled) return { ok: false, status: 403 };
      const t = now();
      const recent = recentFails(ip, t);
      if (recent.length >= MAX_FAILS) return { ok: false, status: 429 };
      // HMAC выравнивает длину, timingSafeEqual — время сравнения.
      if (!timingSafeEqual(mac(`password:${attempt}`), passwordMac)) {
        fails.set(ip, [...recent, t]);
        return { ok: false, status: 401 };
      }
      fails.delete(ip);
      const exp = t + SESSION_TTL_MS;
      return { ok: true, token: `${exp}.${sign(exp)}` };
    },

    verify(token) {
      if (!enabled || !token) return false;
      const m = /^(\d{1,16})\.([A-Za-z0-9_-]{43})$/.exec(token);
      if (!m) return false;
      const exp = Number(m[1]);
      // Сравниваем текст подписи, а не декодированные байты: у base64 есть «лишние» биты в последнем знаке.
      const given = Buffer.from(m[2]);
      const expected = Buffer.from(sign(exp));
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
      return now() < exp;
    },
  };
}
