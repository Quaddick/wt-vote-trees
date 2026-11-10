/** `login()` из `src/api.ts` на подменённом fetch: 403 бывает по двум причинам, и страница не должна их путать. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, login } from '../../src/api';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Ответы «сервера» по адресу; что не описано — 404. */
function serve(routes: Record<string, () => Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input).replace(/^\/+/, '');
      return routes[path]?.() ?? json(404, { error: 'Нет такого адреса API' });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('login: ответ 403', () => {
  it('чужой Origin при включённом входе — ApiError 403 с текстом сервера, а не «вход выключен»', async () => {
    serve({
      'api/login': () => json(403, { error: 'Запрос с чужого сайта' }),
      'api/me': () => json(200, { editor: false, editingEnabled: true }),
    });
    const outcome = await login('secret').then(
      (r) => ({ resolved: r }),
      (e: unknown) => ({ rejected: e }),
    );
    expect(outcome).not.toHaveProperty('resolved');
    const err = (outcome as { rejected: unknown }).rejected;
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).message).toBe('Запрос с чужого сайта');
  });

  it('вход выключен на сервере — «disabled»', async () => {
    serve({
      'api/login': () => json(403, { error: 'Вход выключен: на сервере не задан пароль' }),
      'api/me': () => json(200, { editor: false, editingEnabled: false }),
    });
    await expect(login('secret')).resolves.toBe('disabled');
  });

  it('проверить /api/me не вышло — ApiError 403 с текстом сервера', async () => {
    serve({
      'api/login': () => json(403, { error: 'Запрос с чужого сайта' }),
      'api/me': () => json(502, {}),
    });
    await expect(login('secret')).rejects.toMatchObject({ status: 403, message: 'Запрос с чужого сайта' });
  });
});
