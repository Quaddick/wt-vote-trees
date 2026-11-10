import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { PASSWORD, PORTS, e2eRoot, urlOf } from './e2e/env';

const root = e2eRoot();

function server(name: keyof typeof PORTS, opts: { build?: boolean; password: string }) {
  return {
    // Серверы стартуют по очереди: первый собирает dist/, остальные раздают уже собранное.
    command: opts.build ? 'npm run build && npm start' : 'npm start',
    url: `${urlOf(name)}/api/state`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore' as const,
    stderr: 'pipe' as const,
    env: {
      PORT: String(PORTS[name]),
      DATA_DIR: join(root, name),
      SEED_FILE: join(root, 'seed.json'),
      ADMIN_PASSWORD: opts.password,
      SESSION_SECRET: '',
      TRUSTED_PROXIES: '',
      STATIC_DIR: './dist',
    },
  };
}

export default defineConfig({
  testDir: 'e2e',
  // Тесты делят сервер main и его данные — по одному, по порядку.
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 7_000 },
  reporter: [['list']],
  use: {
    baseURL: urlOf('main'),
    ...devices['Desktop Chrome'],
    // Шире 1700 px: «Последние изменения» — боковая панель, а не выезжающая.
    viewport: { width: 1800, height: 1000 },
    locale: 'ru-RU',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    server('main', { build: true, password: PASSWORD }),
    server('limit', { password: PASSWORD }),
    server('readonly', { password: '' }),
  ],
});
