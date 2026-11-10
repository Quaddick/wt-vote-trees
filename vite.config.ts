import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vite';

/** Порт API-сервера в разработке; Vite проксирует на него `/api`. */
const API_PORT = Number(process.env.PORT ?? 8080);
const SERVER_ENTRY = 'server/main.ts';

/**
 * `npm run dev` поднимает рядом с Vite сервер API (`tsx watch server/main.ts`),
 * чтобы одна команда давала и страницу, и API. Нет файла сервера — только предупреждение.
 */
function apiServer(): Plugin {
  let child: ChildProcess | null = null;
  const stop = () => {
    child?.kill();
    child = null;
  };
  return {
    name: 'wtv-api-server',
    apply: 'serve',
    configureServer(server) {
      if (process.env.VITEST) return;
      if (!existsSync(SERVER_ENTRY)) {
        server.config.logger.warn(`[api] нет ${SERVER_ENTRY} — API не запущен, /api будет отвечать ошибкой`);
        return;
      }
      child = spawn(process.execPath, ['--import', 'tsx', '--watch', SERVER_ENTRY], {
        stdio: 'inherit',
        env: { ...process.env, PORT: String(API_PORT) },
      });
      server.httpServer?.once('close', stop);
      process.once('exit', stop);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [preact(), apiServer()],
  server: {
    proxy: { '/api': `http://localhost:${API_PORT}` },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
