import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StateResponse } from '../../shared/types';
import { createApp, proxyMatcher } from '../../server/app';
import { createAuth } from '../../server/auth';
import { openStore } from '../../server/store';

// Тестовый пароль — только для этого файла.
const TEST_PASSWORD = 'test-only-password';

let root: string;
let server: Server;
let base: string;

async function start(opts: { password?: string; staticDir?: string | null; trustedProxies?: string[] } = {}) {
  const store = openStore({ dataDir: join(root, 'runtime'), seedFile: join(root, 'seed.json') });
  const auth = createAuth({ password: opts.password ?? TEST_PASSWORD, secret: 'test-only-secret' });
  const staticDir = opts.staticDir === undefined ? null : opts.staticDir;
  server = createServer(createApp({ store, auth, staticDir, trustedProxies: opts.trustedProxies }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'wtv-app-'));
  writeFileSync(join(root, 'seed.json'), JSON.stringify({ ussr_is_2: { c: 0.5 } }));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise((r) => server?.close(r));
  rmSync(root, { recursive: true, force: true });
});

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function loginCookie(): Promise<string> {
  const res = await post('/api/login', { password: TEST_PASSWORD });
  expect(res.status).toBe(204);
  return res.headers.getSetCookie()[0].split(';')[0];
}

describe('GET /api/state', () => {
  it('отдаёт StateResponse с ETag; совпавший If-None-Match → 304', async () => {
    await start();
    const res = await fetch(base + '/api/state');
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBe('"0"');
    expect(await res.json()).toEqual({ version: 0, values: { ussr_is_2: { c: 0.5 } }, changes: [] });

    const again = await fetch(base + '/api/state', { headers: { 'if-none-match': '"0"' } });
    expect(again.status).toBe(304);

    const cookie = await loginCookie();
    await post('/api/edit', { edits: [{ ids: ['a'], to: { b: true } }] }, { cookie });
    const changed = await fetch(base + '/api/state', { headers: { 'if-none-match': '"0"' } });
    expect(changed.status).toBe(200);
    expect(changed.headers.get('etag')).toBe('"1"');
  });
});

describe('вход', () => {
  it('верный пароль → 204 + cookie HttpOnly SameSite=Strict; /api/me видит редактора', async () => {
    await start();
    expect(await (await fetch(base + '/api/me')).json()).toEqual({ editor: false, editingEnabled: true });
    const res = await post('/api/login', { password: TEST_PASSWORD });
    expect(res.status).toBe(204);
    const setCookie = res.headers.getSetCookie()[0];
    expect(setCookie).toMatch(/^wtv_session=[^;]+/);
    expect(setCookie).toMatch(/;\s*HttpOnly/i);
    expect(setCookie).toMatch(/;\s*SameSite=Strict/i);
    expect(setCookie).toMatch(/;\s*Path=\//i);
    expect(setCookie).not.toMatch(/;\s*Secure/i);
    const cookie = setCookie.split(';')[0];
    expect(await (await fetch(base + '/api/me', { headers: { cookie } })).json()).toEqual({
      editor: true,
      editingEnabled: true,
    });
  });

  it('за https-прокси cookie получает Secure', async () => {
    await start();
    const res = await post('/api/login', { password: TEST_PASSWORD }, { 'x-forwarded-proto': 'https' });
    expect(res.headers.getSetCookie()[0]).toMatch(/;\s*Secure/i);
  });

  it('неверный пароль → 401 с ошибкой по-русски; 6-я ошибка → 429', async () => {
    await start();
    for (let i = 0; i < 5; i++) {
      const res = await post('/api/login', { password: 'wrong' });
      expect(res.status).toBe(401);
      expect((await res.json()).error).toMatch(/[а-я]/i);
    }
    const res = await post('/api/login', { password: 'wrong' });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('Слишком много попыток, подожди 10 минут');
  });

  it('без доверенного прокси подмена X-Forwarded-For не обходит лимит', async () => {
    await start();
    for (let i = 0; i < 5; i++) {
      const res = await post('/api/login', { password: 'wrong' }, { 'x-forwarded-for': `10.0.0.${i}` });
      expect(res.status).toBe(401);
    }
    const res = await post('/api/login', { password: 'wrong' }, { 'x-forwarded-for': '10.0.0.99' });
    expect(res.status).toBe(429);
    const right = await post('/api/login', { password: TEST_PASSWORD }, { 'x-forwarded-for': '192.168.1.7, 10.0.0.98' });
    expect(right.status).toBe(429);
  });

  it('за доверенным прокси лимит считается по адресу, который дописал прокси', async () => {
    await start({ trustedProxies: ['127.0.0.1'] });
    for (let i = 0; i < 5; i++) {
      // клиент подсовывает свой адрес первым, прокси дописывает настоящий последним
      const xff = `6.6.6.${i}, 203.0.113.5`;
      expect((await post('/api/login', { password: 'wrong' }, { 'x-forwarded-for': xff })).status).toBe(401);
    }
    expect((await post('/api/login', { password: 'wrong' }, { 'x-forwarded-for': '203.0.113.5' })).status).toBe(429);
    expect((await post('/api/login', { password: 'wrong' }, { 'x-forwarded-for': '203.0.113.6' })).status).toBe(401);
  });

  it('доверенные прокси: точные адреса и IPv4-подсети; неверная подсеть — ошибка', () => {
    const m = proxyMatcher(['172.18.0.0/16', '::1', ' 10.1.2.3 ']);
    expect(m('172.18.0.1')).toBe(true);
    expect(m('::ffff:172.18.255.254')).toBe(true);
    expect(m('172.19.0.1')).toBe(false);
    expect(m('::1')).toBe(true);
    expect(m('10.1.2.3')).toBe(true);
    expect(m('10.1.2.4')).toBe(false);
    expect(proxyMatcher([])('127.0.0.1')).toBe(false);
    expect(() => proxyMatcher(['10.0.0.0/40'])).toThrow(/10\.0\.0\.0\/40/);
  });

  it('пароль пуст → вход 403, editingEnabled: false', async () => {
    await start({ password: '' });
    expect((await post('/api/login', { password: '' })).status).toBe(403);
    expect(await (await fetch(base + '/api/me')).json()).toEqual({ editor: false, editingEnabled: false });
  });

  it('logout → 204 и стёртая cookie', async () => {
    await start();
    const cookie = await loginCookie();
    const res = await post('/api/logout', {}, { cookie });
    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie()[0]).toMatch(/^wtv_session=;.*Max-Age=0/i);
  });
});

describe('POST /api/edit', () => {
  it('без сессии → 401, значения не меняются', async () => {
    await start();
    const res = await post('/api/edit', { edits: [{ ids: ['ussr_is_2'], to: { b: true } }] });
    expect(res.status).toBe(401);
    expect(typeof (await res.json()).error).toBe('string');
    const forged = await post('/api/edit', { edits: [{ ids: ['x'], to: { b: true } }] }, { cookie: 'wtv_session=1.abc' });
    expect(forged.status).toBe(401);
    expect(((await (await fetch(base + '/api/state')).json()) as StateResponse).version).toBe(0);
  });

  it('с сессией: одна запись на запрос, только изменившиеся; повтор записи не создаёт; чужие ID хранятся', async () => {
    await start();
    const cookie = await loginCookie();
    const res = await post(
      '/api/edit',
      { edits: [{ ids: ['ussr_is_2', 'germ_tiger', 'not_in_catalog_yet'], to: { c: 0.5 } }] },
      { cookie },
    );
    expect(res.status).toBe(200);
    const s = (await res.json()) as StateResponse;
    expect(s.version).toBe(1);
    expect(s.values.not_in_catalog_yet).toEqual({ c: 0.5 });
    expect(s.changes).toHaveLength(1);
    expect(s.changes[0].kind).toBe('edit');
    expect(s.changes[0].items.map((i) => i.id)).toEqual(['germ_tiger', 'not_in_catalog_yet']);

    const repeat = (await (
      await post('/api/edit', { edits: [{ ids: ['germ_tiger'], to: { c: 0.5 } }] }, { cookie })
    ).json()) as StateResponse;
    expect(repeat.version).toBe(1);
    expect(repeat.changes).toHaveLength(1);

    const imp = (await (
      await post('/api/edit', { edits: [{ ids: ['a'], to: { c: 0.3 } }], kind: 'import' }, { cookie })
    ).json()) as StateResponse;
    expect(imp.changes[0].kind).toBe('import');
  });

  it('неверное тело → 400 { error }', async () => {
    await start();
    const cookie = await loginCookie();
    const bad: unknown[] = [
      '{ not json',
      {},
      { edits: [] },
      { edits: [{ ids: [], to: { c: 1 } }] },
      { edits: [{ ids: ['a'], to: { c: 0 } }] },
      { edits: [{ ids: ['a'], to: { c: 0.123 } }] },
      { edits: [{ ids: ['a'], to: { b: false } }] },
      { edits: [{ ids: [42], to: { c: 1 } }] },
      { edits: [{ ids: ['__proto__'], to: { c: 1 } }] },
      { edits: [{ ids: ['a'], to: { c: 1 } }], kind: 'undo' },
    ];
    for (const body of bad) {
      const res = await post('/api/edit', body, { cookie });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect((await res.json()).error).toMatch(/[а-я]/i);
    }
    expect(((await (await fetch(base + '/api/state')).json()) as StateResponse).version).toBe(0);
  });

  it('чужой Origin → 403; не-JSON → 415; тело больше 256 КБ → 413', async () => {
    await start();
    const cookie = await loginCookie();
    const body = { edits: [{ ids: ['a'], to: { b: true } }] };
    expect((await post('/api/edit', body, { cookie, origin: 'https://evil.example' })).status).toBe(403);
    expect((await post('/api/edit', body, { cookie, origin: 'null' })).status).toBe(403);
    expect((await post('/api/login', { password: TEST_PASSWORD }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post('/api/edit', body, { cookie, 'content-type': 'text/plain' })).status).toBe(415);
    const ids = Array.from({ length: 30_000 }, (_, i) => `vehicle_${i}`);
    const big = await post('/api/edit', { edits: [{ ids, to: { b: true } }] }, { cookie });
    expect(big.status).toBe(413);
    expect(((await (await fetch(base + '/api/state')).json()) as StateResponse).version).toBe(0);
  });
});

it('большое тело без Content-Length (chunked) → тоже 413, а не обрыв', async () => {
  await start();
  const chunk = new TextEncoder().encode('x'.repeat(64 * 1024));
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent++ < 8) controller.enqueue(chunk);
      else controller.close();
    },
  });
  const res = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: stream,
    duplex: 'half',
  } as RequestInit);
  expect(res.status).toBe(413);
});

describe('POST /api/undo', () => {
  it('возвращает «было» и пишет запись undo с undoOf; неизвестный seq → 404; без сессии → 401', async () => {
    await start();
    const cookie = await loginCookie();
    await post('/api/edit', { edits: [{ ids: ['ussr_is_2'], to: { b: true } }] }, { cookie });
    expect((await post('/api/undo', { seq: 1 })).status).toBe(401);
    const res = await post('/api/undo', { seq: 1 }, { cookie });
    expect(res.status).toBe(200);
    const s = (await res.json()) as StateResponse;
    expect(s.values.ussr_is_2).toEqual({ c: 0.5 });
    expect(s.changes[0]).toMatchObject({ seq: 2, kind: 'undo', undoOf: 1 });
    const missing = await post('/api/undo', { seq: 99 }, { cookie });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toMatch(/[а-я]/i);
    expect((await post('/api/undo', { seq: 'one' }, { cookie })).status).toBe(400);
  });
});

describe('статика', () => {
  function makeDist(): string {
    const dist = join(root, 'dist');
    mkdirSync(join(dist, 'catalog', 'slots'), { recursive: true });
    mkdirSync(join(dist, 'assets'), { recursive: true });
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>index</title>');
    writeFileSync(join(dist, 'catalog', 'trees.json'), '{"version":1}');
    writeFileSync(join(dist, 'assets', 'app.js'), 'console.log(1)');
    writeFileSync(join(root, 'secret.txt'), 'top secret');
    return dist;
  }

  function rawGet(path: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = request(base + '/', { path }, (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on('error', reject);
      req.end();
    });
  }

  it('файлы из dist, неизвестный путь → index.html, /catalog/* с кэшем на сутки', async () => {
    await start({ staticDir: makeDist() });
    const index = await fetch(base + '/');
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toMatch(/text\/html/);
    expect(await index.text()).toContain('<title>index</title>');

    const spa = await fetch(base + '/ussr/some/deep/route');
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain('<title>index</title>');

    const js = await fetch(base + '/assets/app.js');
    expect(js.headers.get('content-type')).toMatch(/javascript/);
    expect(await js.text()).toBe('console.log(1)');

    const catalog = await fetch(base + '/catalog/trees.json');
    expect(catalog.status).toBe(200);
    expect(catalog.headers.get('content-type')).toMatch(/application\/json/);
    expect(catalog.headers.get('cache-control')).toMatch(/max-age=86400/);
    expect(await catalog.json()).toEqual({ version: 1 });

    expect((await fetch(base + '/catalog/slots/no_such_tank.webp')).status).toBe(404);
  });

  it('выйти за пределы dist нельзя', async () => {
    await start({ staticDir: makeDist() });
    for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/catalog/..%5c..%5csecret.txt']) {
      const r = await rawGet(path);
      expect(r.body, path).not.toContain('top secret');
    }
  });

  it('без staticDir страница не раздаётся, API работает; неизвестный /api/* → 404 JSON', async () => {
    await start({ staticDir: null });
    expect((await fetch(base + '/')).status).toBe(404);
    const api = await fetch(base + '/api/nope');
    expect(api.status).toBe(404);
    expect((await api.json()).error).toMatch(/[а-я]/i);
  });
});
