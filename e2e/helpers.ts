import { expect, type Page } from '@playwright/test';
import { PASSWORD } from './env';

/** Карточка машины в дереве. */
export const card = (page: Page, id: string) => page.locator(`.card[data-vid="${id}"]`);

/** Строки «Последних изменений» (основная кнопка каждой записи). */
export const historyRows = (page: Page) => page.getByRole('complementary', { name: 'Последние изменения' }).getByRole('listitem');

/** Открыть страницу и дождаться дерева и ответа `/api/me`. */
export async function openSite(page: Page, path = '/'): Promise<void> {
  const me = page.waitForResponse((r) => r.url().endsWith('/api/me'));
  await page.goto(path);
  await me;
  await expect(page.getByRole('tab').first()).toBeVisible();
}

export async function logIn(page: Page, password = PASSWORD): Promise<void> {
  await page.getByRole('button', { name: 'Вход' }).click();
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByText('Режим правки', { exact: true })).toBeVisible();
}

export const editPanel = (page: Page) => page.getByRole('region', { name: 'Правка значения' });

/** Версия значений на сервере — чтобы проверить, что запрос ничего не поменял. */
export async function serverVersion(page: Page): Promise<number> {
  const res = await page.request.get('api/state');
  return ((await res.json()) as { version: number }).version;
}
