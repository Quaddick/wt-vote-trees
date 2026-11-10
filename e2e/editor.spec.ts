/** Путь стримера на собранном сервере: вход, правка, сбой, выделение, отмена, файл значений. */
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, urlOf } from './env';
import { card, editPanel, historyRows, logIn, openSite, serverVersion } from './helpers';

const valueOn = (page: Page, id: string) => card(page, id).locator('.card-value, .card-cross');

test('вход: неверный пароль — «Неверный пароль», поле не очищается; верный — режим правки', async ({ page }) => {
  await openSite(page, '/#ussr');
  await page.getByRole('button', { name: 'Вход' }).click();
  const field = page.getByLabel('Пароль');
  await field.fill('definitely-wrong');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByRole('alert')).toHaveText('Неверный пароль');
  await expect(field).toHaveValue('definitely-wrong');
  await expect(page.getByText('Режим правки', { exact: true })).toHaveCount(0);

  await page.getByRole('dialog', { name: 'Вход' }).getByRole('button', { name: 'Отмена' }).click();
  await logIn(page);
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible();

  // сессия переживает перезагрузку страницы
  await page.reload();
  await expect(page.getByText('Режим правки', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page.getByRole('button', { name: 'Вход' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Вход' })).toBeVisible();
});

test('вход: 403 «чужой сайт» — текст сервера; «Вход выключен…» — только при выключенном входе', async ({ page }) => {
  // nginx без `Host $host`: Origin страницы не совпадает с Host — сервер отвечает 403 «Запрос с чужого сайта».
  await openSite(page, '/#ussr');
  // Браузер свой Origin подменить не даёт — запрос уходит из Playwright с чужим Origin, ответ сервера отдаётся странице как есть.
  await page.route('**/api/login', async (route) => {
    const response = await route.fetch({ headers: { ...route.request().headers(), origin: 'http://elsewhere.example' } });
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Вход' }).click();
  await page.getByLabel('Пароль').fill(PASSWORD);
  const res = page.waitForResponse((r) => r.url().endsWith('/api/login'));
  await page.getByRole('button', { name: 'Войти' }).click();
  expect((await res).status()).toBe(403);
  await expect(page.getByRole('alert')).toContainText('Запрос с чужого сайта');
  await expect(page.getByRole('alert')).not.toContainText('Вход выключен');
  await expect(page.getByText('Режим правки', { exact: true })).toHaveCount(0);

  // Страница открыта, пока вход был включён, а сервер перезапустили без пароля: первый /api/me — «включён».
  const stale = await page.context().newPage();
  let firstMe = true;
  await stale.route('**/api/me', async (route) => {
    if (!firstMe) return route.continue();
    firstMe = false;
    await route.fulfill({ json: { editor: false, editingEnabled: true } });
  });
  await openSite(stale, `${urlOf('readonly')}/#ussr`);
  await stale.getByRole('button', { name: 'Вход' }).click();
  await stale.getByLabel('Пароль').fill('anything');
  await stale.getByRole('button', { name: 'Войти' }).click();
  await expect(stale.getByRole('alert')).toHaveText('Вход выключен: на сервере не задан пароль');
  await stale.close();
});

test('пресет применяется сразу, второй браузер видит значение и «было 1» за 12 с', async ({ page, browser }) => {
  const viewer = await browser.newPage();
  await openSite(viewer, '/#ussr');
  await expect(valueOn(viewer, 'ussr_bt_5')).toHaveText('1');

  await openSite(page, '/#ussr');
  await logIn(page);
  await card(page, 'ussr_bt_5').click();
  await editPanel(page).getByRole('button', { name: '0.5', exact: true }).click();
  await expect(valueOn(page, 'ussr_bt_5')).toHaveText('0.5');
  await expect(card(page, 'ussr_bt_5')).not.toContainText('сохраняю…');
  await expect(historyRows(page).first()).toContainText('БТ-5 · 1 → 0.5');

  await expect(valueOn(viewer, 'ussr_bt_5')).toHaveText('0.5', { timeout: 12_000 });
  await expect(card(viewer, 'ussr_bt_5').locator('.card-was')).toHaveText('было 1');
  await viewer.close();
});

test('«свой»: 0 / 11 / abc — ошибка, запрос не уходит, введённое остаётся; «0,25» принимается', async ({ page }) => {
  await openSite(page, '/#ussr');
  await logIn(page);
  let edits = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/api/edit')) edits++;
  });
  await card(page, 'ussr_t_26_1940').click();
  const field = editPanel(page).getByLabel('Свой коэффициент');
  for (const bad of ['0', '11', 'abc']) {
    await field.fill(bad);
    await editPanel(page).getByRole('button', { name: 'Применить' }).click();
    await expect(editPanel(page).getByRole('alert')).toHaveText('Коэффициент — число от 0.01 до 10');
    await expect(field).toHaveValue(bad);
  }
  expect(edits).toBe(0);
  await expect(valueOn(page, 'ussr_t_26_1940')).toHaveText('1');

  await field.fill('0,25');
  await field.press('Enter');
  await expect(valueOn(page, 'ussr_t_26_1940')).toHaveText('0.25');
  await expect(historyRows(page).first()).toContainText('Т-26 · 1 → 0.25');
  expect(edits).toBe(1);
});

test('сбой сохранения — карточка возвращается и тост; 401 — «Сессия истекла», режим зрителя', async ({ page, context }) => {
  await openSite(page, '/#ussr');
  await logIn(page);
  const before = await serverVersion(page);

  await page.route('**/api/edit', (route) => route.abort('connectionfailed'));
  await card(page, 'ussr_t_26_4').click();
  await editPanel(page).getByRole('button', { name: '0.3', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(/Не сохранилось: нет связи с сервером\. Попробуй ещё раз/);
  await expect(valueOn(page, 'ussr_t_26_4')).toHaveText('1');
  await expect(card(page, 'ussr_t_26_4')).not.toContainText('сохраняю…');
  await page.unroute('**/api/edit');

  // сессия пропала (cookie стёрт) — сервер отвечает 401
  await context.clearCookies();
  await editPanel(page).getByRole('button', { name: '0.3', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(/Сессия истекла — войди снова/);
  await expect(valueOn(page, 'ussr_t_26_4')).toHaveText('1');
  await expect(page.getByText('Режим правки', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Вход' })).toBeVisible();
  expect(await serverVersion(page)).toBe(before);
});

test('выделение нескольких машин — одна запись «N машин → ✕»; «Отменить» возвращает «было»', async ({ page }) => {
  await openSite(page, '/#germ');
  await logIn(page);
  const ids = ['germ_a7v', 'germ_garford_putilov', 'germ_beutepanzer_mk_iv'];
  await card(page, ids[0]).click();
  await card(page, ids[1]).click({ modifiers: ['Control'] });
  await card(page, ids[2]).click({ modifiers: ['Shift'] });
  await expect(editPanel(page)).toContainText('Выбрано: 3');
  for (const id of ids) await expect(card(page, id)).toHaveClass(/\bis-selected\b/);

  const before = await serverVersion(page);
  await editPanel(page).getByRole('button', { name: '✕ Блок' }).click();
  for (const id of ids) await expect(valueOn(page, id)).toHaveText('✕');
  const row = historyRows(page).first();
  await expect(row).toContainText('3 машины → ✕');
  expect(await serverVersion(page)).toBe(before + 1);

  await page.keyboard.press('Escape');
  await expect(editPanel(page)).toHaveCount(0);

  await row.getByRole('button', { name: 'Отменить' }).click();
  for (const id of ids) await expect(valueOn(page, id)).toHaveText('1');
  // Новой строки «отмена» нет: та же строка зачёркнута, «Отменить» у неё пропал.
  const undone = historyRows(page).first();
  await expect(undone).toContainText('3 машины → ✕');
  await expect(undone).toContainText('отменено');
  await expect(undone).toHaveClass(/\bis-undone\b/);
  await expect(undone.getByRole('button', { name: 'Отменить' })).toHaveCount(0);
  expect(await serverVersion(page)).toBe(before + 2);
});

test('переключатель «Выделение» копит выбор обычными кликами', async ({ page }) => {
  await openSite(page, '/#fr');
  await logIn(page);
  await page.getByRole('button', { name: 'Выделение' }).click();
  await card(page, 'fr_amc_34').click();
  await card(page, 'fr_hotchkiss_h35').click();
  await expect(editPanel(page)).toContainText('Выбрано: 2');
  await editPanel(page).getByRole('button', { name: '0.8', exact: true }).click();
  await expect(valueOn(page, 'fr_amc_34')).toHaveText('0.8');
  await expect(valueOn(page, 'fr_hotchkiss_h35')).toHaveText('0.8');
  await expect(historyRows(page).first()).toContainText('2 машины → 0.8');
});

test('«Скачать значения» → wt-values-ГГГГ-ММ-ДД.json; «Загрузить» — превью и одна запись; битый файл — отказ', async ({ page }) => {
  await openSite(page, '/#it');
  await logIn(page);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Скачать значения' }).click(),
  ]);
  const today = await page.evaluate(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  });
  expect(download.suggestedFilename()).toBe(`wt-values-${today}.json`);
  const file = JSON.parse(await readFile(await download.path(), 'utf8')) as { values: Record<string, unknown> };
  expect(file.values.il_m_51).toEqual({ c: 0.5 });
  expect(file.values.it_ab_41).toEqual({ c: 1 });

  // битый файл: ничего не меняется
  const before = await serverVersion(page);
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"oops": 1') });
  await expect(page.getByRole('alert')).toHaveText(/Файл не похож на значения сайта/);
  await expect(page.getByRole('dialog', { name: 'Загрузить значения' })).toHaveCount(0);
  expect(await serverVersion(page)).toBe(before);

  // тот же файл с двумя правками
  file.values.it_ab_41 = { c: 0.3 };
  file.values.it_l6 = { b: true };
  await input.setInputFiles({ name: 'edited.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  const dialog = page.getByRole('dialog', { name: 'Загрузить значения' });
  await expect(dialog).toContainText('Изменится 2 машины');
  expect(await serverVersion(page)).toBe(before);
  await dialog.getByRole('button', { name: 'Применить' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(valueOn(page, 'it_ab_41')).toHaveText('0.3');
  await expect(valueOn(page, 'it_l6')).toHaveText('✕');
  await expect(historyRows(page).first()).toContainText('файл');
  await expect(historyRows(page).first()).toContainText('2 машины изменено');
  expect(await serverVersion(page)).toBe(before + 1);
});
