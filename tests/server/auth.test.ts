import { describe, expect, it } from 'vitest';
import { createAuth } from '../../server/auth';

// Тестовый пароль и секрет — только для тестов, к настоящему .env отношения не имеют.
const TEST_PASSWORD = 'test-only-password';
const TEST_SECRET = 'test-only-secret';
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function clock(start = Date.UTC(2026, 10, 10)) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('вход', () => {
  it('верный пароль → токен, который проходит verify', () => {
    const auth = createAuth({ password: TEST_PASSWORD, secret: TEST_SECRET });
    expect(auth.enabled).toBe(true);
    const r = auth.login(TEST_PASSWORD, '1.2.3.4');
    expect(r.ok).toBe(true);
    expect(auth.verify(r.ok ? r.token : undefined)).toBe(true);
  });

  it('неверный пароль → 401', () => {
    const auth = createAuth({ password: TEST_PASSWORD, secret: TEST_SECRET });
    expect(auth.login('wrong', '1.2.3.4')).toEqual({ ok: false, status: 401 });
    expect(auth.login(TEST_PASSWORD + 'x', '1.2.3.4')).toEqual({ ok: false, status: 401 });
    expect(auth.login('', '1.2.3.4')).toEqual({ ok: false, status: 401 });
  });

  it('пароль пуст → вход выключен, 403', () => {
    for (const password of [undefined, '', '   ']) {
      const auth = createAuth({ password, secret: TEST_SECRET });
      expect(auth.enabled).toBe(false);
      expect(auth.login('', '1.2.3.4')).toEqual({ ok: false, status: 403 });
      expect(auth.login('anything', '1.2.3.4')).toEqual({ ok: false, status: 403 });
    }
  });
});

describe('лимит попыток', () => {
  it('5 ошибок с IP за 10 минут → 6-я попытка 429, даже с верным паролем; другой IP не задет', () => {
    const c = clock();
    const auth = createAuth({ password: TEST_PASSWORD, secret: TEST_SECRET, now: c.now });
    for (let i = 0; i < 5; i++) {
      expect(auth.login('wrong', '9.9.9.9')).toEqual({ ok: false, status: 401 });
      c.advance(MINUTE);
    }
    expect(auth.login('wrong', '9.9.9.9')).toEqual({ ok: false, status: 429 });
    expect(auth.login(TEST_PASSWORD, '9.9.9.9')).toEqual({ ok: false, status: 429 });
    expect(auth.login(TEST_PASSWORD, '8.8.8.8').ok).toBe(true);
  });

  it('через 10 минут после ошибок лимит снимается', () => {
    const c = clock();
    const auth = createAuth({ password: TEST_PASSWORD, secret: TEST_SECRET, now: c.now });
    for (let i = 0; i < 5; i++) auth.login('wrong', '9.9.9.9');
    expect(auth.login(TEST_PASSWORD, '9.9.9.9')).toEqual({ ok: false, status: 429 });
    c.advance(10 * MINUTE + 1);
    expect(auth.login(TEST_PASSWORD, '9.9.9.9').ok).toBe(true);
  });
});

describe('сессия', () => {
  it('живёт 30 дней', () => {
    const c = clock();
    const auth = createAuth({ password: TEST_PASSWORD, secret: TEST_SECRET, now: c.now });
    const r = auth.login(TEST_PASSWORD, '1.2.3.4');
    const token = r.ok ? r.token : '';
    c.advance(30 * DAY - MINUTE);
    expect(auth.verify(token)).toBe(true);
    c.advance(2 * MINUTE);
    expect(auth.verify(token)).toBe(false);
  });

  it('подделанный, чужой или пустой токен не проходит', () => {
    const auth = createAuth({ password: TEST_PASSWORD, secret: TEST_SECRET });
    const other = createAuth({ password: TEST_PASSWORD, secret: 'another-test-secret' });
    const r = auth.login(TEST_PASSWORD, '1.2.3.4');
    const token = r.ok ? r.token : '';
    const o = other.login(TEST_PASSWORD, '1.2.3.4');
    expect(auth.verify(o.ok ? o.token : '')).toBe(false);
    expect(auth.verify(undefined)).toBe(false);
    expect(auth.verify('')).toBe(false);
    expect(auth.verify('garbage')).toBe(false);
    // любой другой последний знак, включая отличающийся одним младшим битом
    const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const idx = ALPHABET.indexOf(token.at(-1)!);
    for (const alt of [ALPHABET[idx ^ 1], ALPHABET[idx ^ 2], ALPHABET[(idx + 32) % 64]]) {
      expect(auth.verify(token.slice(0, -1) + alt)).toBe(false);
    }
    const first = token[0] === '9' ? '8' : '9';
    expect(auth.verify(first + token.slice(1))).toBe(false);
  });

  it('без secret токен действует в пределах одного запуска', () => {
    const a = createAuth({ password: TEST_PASSWORD });
    const b = createAuth({ password: TEST_PASSWORD });
    const r = a.login(TEST_PASSWORD, '1.2.3.4');
    const token = r.ok ? r.token : '';
    expect(a.verify(token)).toBe(true);
    expect(b.verify(token)).toBe(false);
  });

  it('при выключенном входе ни один токен не проходит', () => {
    const on = createAuth({ password: TEST_PASSWORD, secret: TEST_SECRET });
    const off = createAuth({ password: '', secret: TEST_SECRET });
    const r = on.login(TEST_PASSWORD, '1.2.3.4');
    expect(off.verify(r.ok ? r.token : '')).toBe(false);
  });
});
