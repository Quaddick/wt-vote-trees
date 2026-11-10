/** Путь зрителя на собранном сервере: вкладки, поиск, фильтр, ссылка, список на узком экране. */
import { expect, test } from '@playwright/test';
import { PASSWORD, urlOf } from './env';
import { card, logIn, openSite } from './helpers';

test('10 вкладок наций с флагами; переключение без перезагрузки, адрес #нация', async ({ page }) => {
  await openSite(page);
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(10);
  await expect(tabs).toHaveText(['США', 'Германия', 'СССР', 'Великобритания', 'Япония', 'Китай', 'Италия', 'Франция', 'Швеция', 'Израиль']);
  await expect(tabs.first().locator('img')).toHaveAttribute('src', /flags\/us\.svg$/);

  await page.evaluate(() => ((window as unknown as { marker: number }).marker = 1));
  await page.getByRole('tab', { name: 'Израиль' }).click();
  await expect(page).toHaveURL(/#il$/);
  await expect(page.getByRole('tab', { name: 'Израиль' })).toHaveAttribute('aria-selected', 'true');
  // стартовые значения e2e-сервера: коэффициент и блок на карточках
  await expect(card(page, 'il_m_51').locator('.card-value')).toHaveText('0.5');
  await expect(card(page, 'il_amx_13_75').locator('.card-cross')).toHaveText('✕');
  await expect(card(page, 'il_amx_13_75')).toHaveClass(/\bis-blocked\b/);
  expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBe(1);
});

test('поиск по «/»: выбор ведёт на нацию и машину', async ({ page }) => {
  await openSite(page);
  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox', { name: 'Поиск машины' })).toBeFocused();
  await page.keyboard.type('tiger h1');
  await page.locator('[data-result="germ_pzkpfw_vi_ausf_h1_tiger"]').click();
  await expect(page).toHaveURL(/#germ\/germ_pzkpfw_vi_ausf_h1_tiger$/);
  await expect(page.getByRole('tab', { name: 'Германия' })).toHaveAttribute('aria-selected', 'true');
  await expect(card(page, 'germ_pzkpfw_vi_ausf_h1_tiger')).toBeInViewport();

  await page.getByRole('searchbox', { name: 'Поиск машины' }).fill('нет такой машины');
  await expect(page.getByText('Ничего не нашлось')).toBeVisible();
});

test('легенда — фильтр: «0.5» приглушает остальные, повторное нажатие снимает', async ({ page }) => {
  await openSite(page, '/#il');
  const chip = page.getByRole('button', { name: /^0\.5 — 2 машины$/ });
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page, 'il_m_51')).not.toHaveClass(/is-filtered-out/);
  await expect(card(page, 'il_tcm_20')).not.toHaveClass(/is-filtered-out/);
  await expect(card(page, 'il_amx_13_75')).toHaveClass(/is-filtered-out/);
  await chip.click();
  await expect(card(page, 'il_amx_13_75')).not.toHaveClass(/is-filtered-out/);
});

test('ссылка #нация/машина открывает нацию и подсвечивает машину', async ({ page }) => {
  await openSite(page, '/#ussr/ussr_is_2_1943');
  await expect(page.getByRole('tab', { name: 'СССР' })).toHaveAttribute('aria-selected', 'true');
  const target = card(page, 'ussr_is_2_1943');
  await expect(target).toHaveClass(/\bis-flash\b/);
  await expect(target).toBeInViewport();
});

test('клик зрителя по карточке — подробности, а не правка', async ({ page }) => {
  await openSite(page, '/#il');
  await card(page, 'il_m_51').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('M-51');
  await expect(dialog.getByTestId('details-value')).toHaveText('0.5');
  await expect(page.getByRole('region', { name: 'Правка значения' })).toHaveCount(0);
});

test.describe('узкий экран', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('по умолчанию «Список»; «Последние изменения» — выезжающая панель', async ({ page }) => {
    await openSite(page, '/#il');
    await expect(page.getByRole('button', { name: 'Список' })).toHaveAttribute('aria-pressed', 'true');
    const row = page.locator('.row[data-vid="il_m_51"]');
    await expect(row).toBeVisible();
    await expect(row.locator('.card-value')).toHaveText('0.5');
    const panel = page.getByRole('complementary', { name: 'Последние изменения' });
    await expect(panel).not.toBeInViewport();
    await page.getByRole('button', { name: /^Изменения/ }).click();
    await expect(panel).toBeInViewport();
  });

  test('при прокрутке закреплена только полоса наций, поиск уезжает', async ({ page }) => {
    await openSite(page, '/#ussr');
    const search = page.getByRole('combobox').or(page.getByPlaceholder('Поиск машины')).first();
    await expect(search).toBeInViewport();
    expect((await search.boundingBox())!.width).toBeGreaterThan(300);
    await page.evaluate(() => window.scrollTo(0, 1500));
    const tabs = page.getByRole('tablist', { name: 'Нации' });
    await expect(tabs).toBeInViewport();
    expect((await tabs.boundingBox())!.y).toBeLessThanOrEqual(1);
    expect((await tabs.boundingBox())!.height).toBeLessThan(60);
    await expect(search).not.toBeInViewport();
  });
});

test('без пароля на сервере кнопки «Вход» нет', async ({ page }) => {
  await openSite(page, `${urlOf('readonly')}/#il`);
  await expect(card(page, 'il_m_51')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Вход' })).toHaveCount(0);
  const res = await page.request.post(`${urlOf('readonly')}/api/edit`, {
    data: { edits: [{ ids: ['il_m_51'], to: { c: 0.2 } }] },
  });
  expect(res.status()).toBe(401);
});

test('5 неверных паролей — шестая попытка: «Слишком много попыток, подожди 10 минут»', async ({ page }) => {
  // Отдельный сервер: блокировка адреса на 10 минут не задевает остальные тесты.
  await openSite(page, urlOf('limit'));
  await page.getByRole('button', { name: 'Вход' }).click();
  const field = page.getByLabel('Пароль');
  const attempt = async (password: string) => {
    await field.fill(password);
    const res = page.waitForResponse((r) => r.url().endsWith('/api/login'));
    await page.getByRole('button', { name: 'Войти' }).click();
    return (await res).status();
  };
  for (let i = 1; i <= 5; i++) {
    expect(await attempt(`wrong-${i}`)).toBe(401);
    await expect(page.getByRole('alert')).toHaveText('Неверный пароль');
    await expect(field).toHaveValue(`wrong-${i}`);
  }
  expect(await attempt('wrong-6')).toBe(429);
  await expect(page.getByRole('alert')).toHaveText('Слишком много попыток, подожди 10 минут');
  // и верный пароль с этого адреса теперь тоже ждёт
  expect(await attempt(PASSWORD)).toBe(429);
  await expect(page.getByText('Режим правки', { exact: true })).toHaveCount(0);
});

test('зритель не видит «Отменить» у записей истории', async ({ browser, page }) => {
  // запись в истории делает стример в своём браузере
  const streamer = await browser.newPage();
  await openSite(streamer, '/#jp');
  await logIn(streamer);
  await card(streamer, 'jp_type_95_ha_go').click();
  await streamer.getByRole('region', { name: 'Правка значения' }).getByRole('button', { name: '0.4' }).click();
  await expect(card(streamer, 'jp_type_95_ha_go').locator('.card-value')).toHaveText('0.4');
  await expect(streamer.getByRole('button', { name: 'Отменить' }).first()).toBeVisible();
  await streamer.close();

  await openSite(page, '/#jp');
  await expect(page.getByRole('complementary', { name: 'Последние изменения' })).toContainText('Ha-Go · 1 → 0.4');
  await expect(page.getByRole('button', { name: 'Отменить' })).toHaveCount(0);
});
