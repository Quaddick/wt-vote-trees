/**
 * Подмена `src/api.ts` для компонентных тестов: «сервер» в памяти.
 * Подключение: `vi.mock('../../src/api', () => import('./fake-api'))`.
 */
import { vi } from 'vitest';
import type { StateResponse, TreeCatalog } from '../../shared/types';
import { fixtureCatalog } from './fixtures';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const fake = {
  catalog: fixtureCatalog() as TreeCatalog,
  state: { version: 0, values: {}, changes: [] } as StateResponse,
  /** true — сервер недоступен (fetchState бросает). */
  down: false,
  me: { editor: false, editingEnabled: false },
};

export function resetFake(catalog: TreeCatalog = fixtureCatalog()): void {
  fake.catalog = catalog;
  fake.state = { version: 0, values: {}, changes: [] };
  fake.down = false;
  fake.me = { editor: false, editingEnabled: false };
  fetchState.mockClear();
}

export const fetchState = vi.fn(async (etag?: string) => {
  if (fake.down) throw new ApiError(0, 'нет связи с сервером');
  const current = `"${fake.state.version}"`;
  if (etag === current) return 'not-modified' as const;
  return { state: structuredClone(fake.state), etag: current };
});

export const loadCatalog = vi.fn(async () => fake.catalog);
export const fetchMe = vi.fn(async () => ({ ...fake.me }));
export const login = vi.fn(async () => 'ok' as const);
export const logout = vi.fn(async () => {});
export const sendEdit = vi.fn(async () => structuredClone(fake.state));
export const sendUndo = vi.fn(async () => structuredClone(fake.state));
