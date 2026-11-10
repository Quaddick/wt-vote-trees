/**
 * HTTP API и раздача собранной страницы на голом node:http.
 * Сервер только хранит и отдаёт значения — никаких расчётов.
 */
import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import type { Edit } from '../shared/types';
import { isValidValue } from '../shared/values';
import { SESSION_TTL_MS, type Auth } from './auth';
import { NotFoundError, type Store } from './store';

export const SESSION_COOKIE = 'wtv_session';
const MAX_BODY_BYTES = 256 * 1024;
const MAX_DRAIN_BYTES = 4 * 1024 * 1024;
const MAX_ID_LENGTH = 100;
const ID_RE = /^[A-Za-z0-9_.-]+$/;
const FORBIDDEN_IDS = new Set(['__proto__', 'constructor', 'prototype']);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** Ошибка, которая уходит клиенту как `{ error }` с этим статусом. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * trustedProxies — адреса (IPv4/IPv6) или IPv4-подсети (CIDR) прокси, чьему X-Forwarded-For можно верить.
 * По умолчанию пусто: лимит попыток входа считается по адресу соединения, заголовок не читается.
 */
export function createApp(opts: {
  store: Store;
  auth: Auth;
  staticDir: string | null;
  trustedProxies?: string[];
}): RequestListener {
  const { store, auth } = opts;
  const isTrustedProxy = proxyMatcher(opts.trustedProxies ?? []);
  const staticRoot = opts.staticDir ? resolve(opts.staticDir) : null;

  async function handleApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const method = req.method ?? 'GET';

    if (path === '/api/state' || path === '/api/me') {
      if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'Метод не поддерживается');
      res.setHeader('Cache-Control', 'no-cache');
      if (path === '/api/me') {
        return sendJson(res, 200, { editor: auth.verify(sessionToken(req)), editingEnabled: auth.enabled });
      }
      const state = store.state();
      const etag = `"${state.version}"`;
      res.setHeader('ETag', etag);
      if (etagMatches(req.headers['if-none-match'], etag)) {
        res.statusCode = 304;
        res.end();
        return;
      }
      return sendJson(res, 200, state);
    }

    const mutating = ['/api/login', '/api/logout', '/api/edit', '/api/undo'];
    if (!mutating.includes(path)) throw new HttpError(404, 'Нет такого адреса API');
    if (method !== 'POST') throw new HttpError(405, 'Метод не поддерживается');
    checkOrigin(req);

    if (path === '/api/logout') {
      res.setHeader('Set-Cookie', cookie(req, '', 0));
      res.statusCode = 204;
      res.end();
      return;
    }

    if (path === '/api/login') {
      const body = await readJsonBody(req);
      const password = (body as { password?: unknown } | null)?.password;
      if (typeof password !== 'string') throw new HttpError(400, 'Нужен пароль');
      const r = auth.login(password, clientIp(req, isTrustedProxy));
      if (!r.ok) {
        const messages = {
          401: 'Неверный пароль',
          429: 'Слишком много попыток, подожди 10 минут',
          403: 'Вход выключен: на сервере не задан пароль',
        };
        throw new HttpError(r.status, messages[r.status]);
      }
      res.setHeader('Set-Cookie', cookie(req, r.token, Math.floor(SESSION_TTL_MS / 1000)));
      res.statusCode = 204;
      res.end();
      return;
    }

    // /api/edit, /api/undo — только для вошедших; тело без сессии даже не читаем.
    if (!auth.verify(sessionToken(req))) throw new HttpError(401, 'Сессия истекла — войди снова');
    const body = await readJsonBody(req);

    if (path === '/api/edit') {
      const { edits, kind } = parseEditBody(body);
      store.apply(edits, kind);
      return sendJson(res, 200, store.state());
    }

    const seq = (body as { seq?: unknown } | null)?.seq;
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1) {
      throw new HttpError(400, 'Нужен номер записи истории (seq)');
    }
    try {
      store.undo(seq);
    } catch (e) {
      if (e instanceof NotFoundError) throw new HttpError(404, 'Такой записи в истории нет');
      throw e;
    }
    return sendJson(res, 200, store.state());
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse, path: string): void {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Метод не поддерживается');
    if (!staticRoot) throw new HttpError(404, 'Страница не собрана');

    const file = resolveInside(staticRoot, path);
    if (file && isFile(file)) {
      let cache = 'no-cache';
      if (path.startsWith('/catalog/')) cache = 'public, max-age=86400';
      else if (path.startsWith('/assets/')) cache = 'public, max-age=31536000, immutable';
      return sendFile(req, res, file, cache);
    }
    // Нет файла с расширением в папках ресурсов — честный 404, а не страница.
    if (path.startsWith('/catalog/') || path.startsWith('/assets/')) throw new HttpError(404, 'Файл не найден');
    const index = join(staticRoot, 'index.html');
    if (!isFile(index)) throw new HttpError(404, 'Страница не собрана');
    sendFile(req, res, index, 'no-cache');
  }

  return (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    let path: string;
    try {
      path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      return sendJson(res, 400, { error: 'Неверный адрес' });
    }
    const handler = path.startsWith('/api/')
      ? handleApi(req, res, path)
      : Promise.resolve().then(() => serveStatic(req, res, path));
    handler.catch((e: unknown) => {
      if (e instanceof HttpError) {
        if (e.status === 413) res.setHeader('Connection', 'close');
        return sendJson(res, e.status, { error: e.message });
      }
      console.error('[app] ошибка обработки', req.method, path, e);
      sendJson(res, 500, { error: 'Ошибка сервера' });
    });
  };
}

function parseEditBody(body: unknown): { edits: Edit[]; kind: 'edit' | 'import' } {
  if (typeof body !== 'object' || body === null) throw new HttpError(400, 'Тело запроса — не объект');
  const { edits, kind } = body as { edits?: unknown; kind?: unknown };
  if (kind !== undefined && kind !== 'edit' && kind !== 'import') throw new HttpError(400, 'Неизвестный вид правки');
  if (!Array.isArray(edits) || edits.length === 0) throw new HttpError(400, 'Нет правок');
  const out: Edit[] = [];
  for (const e of edits as unknown[]) {
    const { ids, to } = (e ?? {}) as { ids?: unknown; to?: unknown };
    if (!Array.isArray(ids) || ids.length === 0) throw new HttpError(400, 'В правке не выбрано ни одной машины');
    for (const id of ids) {
      if (typeof id !== 'string' || id.length > MAX_ID_LENGTH || !ID_RE.test(id) || FORBIDDEN_IDS.has(id)) {
        throw new HttpError(400, `Неверный ID машины: ${JSON.stringify(id)?.slice(0, 120)}`);
      }
    }
    if (!isValidValue(to)) throw new HttpError(400, 'Коэффициент — число от 0.01 до 10 или блок');
    out.push({ ids: ids as string[], to });
  }
  return { edits: out, kind: kind ?? 'edit' };
}

/** Изменяющий запрос из браузера с чужой страницы — отказ. Без Origin (curl) — пропускаем: CSRF это не грозит. */
function checkOrigin(req: IncomingMessage): void {
  const origin = req.headers.origin;
  if (origin === undefined) return;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    throw new HttpError(403, 'Запрос с чужого сайта');
  }
  if (!host || host !== req.headers.host) throw new HttpError(403, 'Запрос с чужого сайта');
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'Нужен Content-Type: application/json');
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_DRAIN_BYTES) throw new HttpError(413, 'Слишком большой запрос');
  // Лишнее тело дочитываем впустую (до разумного предела): если закрыть сокет с непрочитанными
  // данными, клиент получит обрыв соединения вместо ответа 413.
  const raw = await new Promise<Buffer>((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
      else if (size > MAX_DRAIN_BYTES) req.destroy();
    });
    req.on('end', () =>
      size > MAX_BODY_BYTES ? reject(new HttpError(413, 'Слишком большой запрос')) : resolveBody(Buffer.concat(chunks)),
    );
    req.on('error', reject);
    req.on('close', () => reject(new HttpError(413, 'Слишком большой запрос')));
  });
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Тело запроса — не JSON');
  }
}

function sessionToken(req: IncomingMessage): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === SESSION_COOKIE) return part.slice(eq + 1).trim();
  }
  return undefined;
}

function isHttps(req: IncomingMessage): boolean {
  if ((req.socket as { encrypted?: boolean }).encrypted) return true;
  const proto = req.headers['x-forwarded-proto'];
  const first = (Array.isArray(proto) ? proto[0] : proto)?.split(',')[0].trim().toLowerCase();
  return first === 'https';
}

function cookie(req: IncomingMessage, value: string, maxAgeSec: number): string {
  const parts = [`${SESSION_COOKIE}=${value}`, 'Path=/', `Max-Age=${maxAgeSec}`, 'HttpOnly', 'SameSite=Strict'];
  if (isHttps(req)) parts.push('Secure');
  return parts.join('; ');
}

/**
 * IP для лимита попыток. X-Forwarded-For читаем, только если соединение пришло от явно доверенного прокси,
 * и берём последний адрес — тот, что дописал этот прокси; всё левее мог подставить клиент.
 */
function clientIp(req: IncomingMessage, isTrustedProxy: (ip: string) => boolean): string {
  const remote = normalizeIp(req.socket.remoteAddress ?? '');
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded && isTrustedProxy(remote)) {
    const list = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded).split(',');
    const last = normalizeIp(list[list.length - 1].trim());
    if (last) return last;
  }
  return remote || 'unknown';
}

function normalizeIp(ip: string): string {
  return ip.replace(/^::ffff:/i, '').toLowerCase();
}

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/** Проверка «адрес — доверенный прокси»: точные адреса и IPv4-подсети вида 172.18.0.0/16. */
export function proxyMatcher(entries: string[]): (ip: string) => boolean {
  const exact = new Set<string>();
  const nets: { base: number; mask: number }[] = [];
  for (const raw of entries) {
    const entry = raw.trim();
    if (!entry) continue;
    const cidr = /^([\d.]+)\/(\d{1,2})$/.exec(entry);
    if (cidr) {
      const base = ipv4ToInt(cidr[1]);
      const bits = Number(cidr[2]);
      if (base === null || bits > 32) throw new Error(`Неверная подсеть доверенного прокси: ${entry}`);
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      nets.push({ base: (base & mask) >>> 0, mask });
    } else {
      exact.add(normalizeIp(entry));
    }
  }
  return (ip) => {
    const n = normalizeIp(ip);
    if (exact.has(n)) return true;
    const v4 = ipv4ToInt(n);
    return v4 !== null && nets.some((net) => ((v4 & net.mask) >>> 0) === net.base);
  };
}

function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(',').some((t) => {
    const s = t.trim();
    return s === '*' || s === etag || s === `W/${etag}`;
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const body = JSON.stringify(data);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);
}

/** Путь внутри корня или null, если запрос пытается выйти наружу. */
function resolveInside(rootDir: string, urlPath: string): string | null {
  if (urlPath.includes('\0')) return null;
  const full = resolve(rootDir, '.' + urlPath.replace(/\\/g, '/'));
  return full === rootDir || full.startsWith(rootDir + sep) ? full : null;
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function sendFile(req: IncomingMessage, res: ServerResponse, file: string, cacheControl: string): void {
  const size = statSync(file).size;
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('Content-Length', size);
  res.setHeader('Cache-Control', cacheControl);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}
