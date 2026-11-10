/**
 * Запуск сервера. Настройки — из окружения:
 * PORT (8080), DATA_DIR (./data/runtime), SEED_FILE (./data/seed/values.json),
 * ADMIN_PASSWORD, SESSION_SECRET, STATIC_DIR (./dist), TRUSTED_PROXIES (пусто).
 */
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { createApp } from './app';
import { createAuth } from './auth';
import { openStore, type Store } from './store';

const env = process.env;
const port = Number(env.PORT || 8080);
const dataDir = resolve(env.DATA_DIR || './data/runtime');
const seedFile = resolve(env.SEED_FILE || './data/seed/values.json');
const staticDirSetting = resolve(env.STATIC_DIR || './dist');

let store: Store;
try {
  store = openStore({ dataDir, seedFile });
} catch (e) {
  console.error(`[server] не стартую: ${(e as Error).message}`);
  process.exit(1);
}

const auth = createAuth({ password: env.ADMIN_PASSWORD, secret: env.SESSION_SECRET || undefined });
if (!auth.enabled) {
  console.warn('[server] ADMIN_PASSWORD не задан — сайт работает только на просмотр, вход выключен');
} else if (!env.SESSION_SECRET) {
  console.warn('[server] SESSION_SECRET не задан — после перезапуска сервера придётся войти заново');
}

let staticDir: string | null = staticDirSetting;
if (!existsSync(join(staticDirSetting, 'index.html'))) {
  console.warn(`[server] нет собранной страницы ${join(staticDirSetting, 'index.html')} — раздаю только API (npm run build)`);
  staticDir = null;
}

// Адреса прокси (nginx), которым можно верить в X-Forwarded-For: через запятую или пробел, можно IPv4/CIDR.
const trustedProxies = (env.TRUSTED_PROXIES ?? '').split(/[\s,]+/).filter(Boolean);
let app: ReturnType<typeof createApp>;
try {
  app = createApp({ store, auth, staticDir, trustedProxies });
} catch (e) {
  console.error(`[server] не стартую: TRUSTED_PROXIES — ${(e as Error).message}`);
  process.exit(1);
}
if (trustedProxies.length > 0) console.log(`[server] доверенные прокси: ${trustedProxies.join(', ')}`);

const server = createServer(app);
server.on('error', (e) => {
  console.error(`[server] не стартую: ${e.message}`);
  process.exit(1);
});
server.listen(port, () => {
  const actual = (server.address() as AddressInfo).port;
  console.log(`[server] данные: ${dataDir}`);
  console.log(`[server] слушаю http://localhost:${actual}`);
});

function shutdown(signal: string) {
  console.log(`[server] ${signal} — останавливаюсь`);
  server.close(() => process.exit(0));
  server.closeAllConnections();
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
