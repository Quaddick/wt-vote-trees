import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fake, resetFake } from './fake-api';
import { card, closePage, openPage } from './harness';

vi.mock('../../src/api', () => import('./fake-api'));

beforeEach(() => resetFake());
afterEach(closePage);

// СССР в фикстуре — 8 машин: 2 по 0.5, 1 блок, остальные 5 — «1».
async function openUssr() {
  fake.state = { version: 1, values: { ussr_bt_5: { c: 0.5 }, ussr_t_26: { c: 0.5 }, ussr_is_2_1944: { b: true } }, changes: [] };
  await openPage('#ussr');
  await waitFor(() => expect(card('ussr_bt_5').getAttribute('data-value')).toBe('0.5'));
}

function legend() {
  return within(screen.getByRole('region', { name: 'Легенда' }));
}

describe('легенда-фильтр', () => {
  it('объясняет цифры и крест', async () => {
    await openUssr();
    expect(legend().getByText('— обычный коэффициент')).toBeTruthy();
    expect(legend().getByText('меньше 1 — пониженный коэффициент')).toBeTruthy();
    expect(legend().getByText('— техника недоступна')).toBeTruthy();
  });

  it('чипы всех значений нации с числом машин', async () => {
    await openUssr();
    const chips = legend().getAllByRole('button');
    expect(chips.map((c) => c.getAttribute('aria-label'))).toEqual(['1 — 5 машин', '0.5 — 2 машины', '✕ — 1 машина']);
  });

  it('клик по чипу приглушает остальные машины нации, повторный снимает', async () => {
    await openUssr();
    const chip = legend().getByRole('button', { name: '0.5 — 2 машины' });
    fireEvent.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(card('ussr_bt_5').className).not.toMatch(/is-filtered-out/);
    expect(card('ussr_t_26').className).not.toMatch(/is-filtered-out/);
    expect(card('ussr_t_34_1940').className).toMatch(/is-filtered-out/);
    expect(card('ussr_is_2_1944').className).toMatch(/is-filtered-out/);

    fireEvent.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelectorAll('.is-filtered-out').length).toBe(0);
  });

  it('у другой нации — свои чипы, фильтр сбрасывается', async () => {
    await openUssr();
    fireEvent.click(legend().getByRole('button', { name: '✕ — 1 машина' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Израиль' }));
    expect(legend().getAllByRole('button').map((c) => c.getAttribute('aria-label'))).toEqual(['1 — 3 машины']);
    expect(document.querySelectorAll('.is-filtered-out').length).toBe(0);
  });
});
