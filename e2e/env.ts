/**
 * Окружение сквозных тестов: три собранных сервера на своих портах, у каждого своя временная папка данных.
 * - main      — с тестовым паролем, общий для зрителя и стримера;
 * - limit     — с тем же паролем, только для проверки лимита неверных попыток (429 не задевает main);
 * - readonly  — без пароля: сайт только на просмотр.
 * Пароль — тестовый, задаётся переменной окружения теста (`E2E_ADMIN_PASSWORD`), не из `.env`.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'e2e-only-password';

const basePort = Number(process.env.E2E_PORT || 4319);
export const PORTS = { main: basePort, limit: basePort + 1, readonly: basePort + 2 } as const;
export const urlOf = (server: keyof typeof PORTS) => `http://localhost:${PORTS[server]}`;

/**
 * Стартовые значения e2e-серверов (вместо data/seed/values.json, чтобы тесты не зависели от расшифровки
 * скриншотов): у Израиля два «0.5» и один блок, остальное — «1».
 */
export const SEED = {
  il_m_51: { c: 0.5 },
  il_tcm_20: { c: 0.5 },
  il_amx_13_75: { b: true },
} as const;

/**
 * Временная папка создаётся один раз в главном процессе Playwright; процессы-исполнители получают её
 * через окружение (конфиг загружается и в них).
 */
export function e2eRoot(): string {
  let root = process.env.WTV_E2E_ROOT;
  if (!root) {
    root = mkdtempSync(join(tmpdir(), 'wtv-e2e-'));
    writeFileSync(join(root, 'seed.json'), JSON.stringify(SEED));
    for (const name of Object.keys(PORTS)) mkdirSync(join(root, name), { recursive: true });
    process.env.WTV_E2E_ROOT = root;
  }
  return root;
}
