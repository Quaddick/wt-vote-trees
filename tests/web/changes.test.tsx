process.env.TZ = 'UTC';

import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Change } from '../../shared/types';
import { fake, resetFake } from './fake-api';
import { card, closePage, openPage } from './harness';

vi.mock('../../src/api', () => import('./fake-api'));

const NOW = Date.parse('2026-11-10T15:00:00Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

const MASS = ['ussr_t_34_1940', 'ussr_t_34_1941', 'ussr_bmp_2m', 'ussr_buk_launcher', 'ussr_t_80u_yt_cup_2019'];

const history: Change[] = [
  { seq: 3, at: ago(10), kind: 'edit', items: [{ id: 'ussr_is_2_1944', from: { c: 1 }, to: { c: 0.5 } }] },
  { seq: 2, at: ago(20), kind: 'edit', items: MASS.map((id) => ({ id, from: { c: 1 }, to: { b: true as const } })) },
  { seq: 1, at: ago(4 * 60), kind: 'edit', items: [{ id: 'ussr_t_26', from: { c: 1 }, to: { c: 0.8 } }] },
];

beforeEach(() => {
  resetFake();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  closePage();
  vi.useRealTimers();
});

function panel() {
  return within(screen.getByRole('complementary', { name: 'Последние изменения' }));
}

/** Строки списка: основная кнопка каждой записи. */
function rows() {
  return panel()
    .getAllByRole('listitem')
    .map((li) => within(li).getAllByRole('button')[0]);
}

async function openWithHistory() {
  fake.state = {
    version: 3,
    values: Object.fromEntries([
      ['ussr_is_2_1944', { c: 0.5 }],
      ['ussr_t_26', { c: 0.8 }],
      ...MASS.map((id) => [id, { b: true }]),
    ]),
    changes: history,
  };
  await openPage('#il');
  await waitFor(() => expect(rows().length).toBe(3));
}

describe('последние изменения', () => {
  it('пусто — «Пока без изменений»', async () => {
    await openPage('#ussr');
    expect(panel().getByText('Пока без изменений')).toBeTruthy();
  });

  it('одиночная правка — «имя · было → стало · ЧЧ:ММ», массовая — «N машин → X»', async () => {
    await openWithHistory();
    const texts = rows().map((r) => r.textContent);
    expect(texts[0]).toBe('ИС-2 обр. 1944 · 1 → 0.5 · 14:50');
    expect(texts[1]).toBe('5 машин → ✕ · 14:40');
    expect(texts[2]).toBe('Т-26 · 1 → 0.8 · 11:00');
  });

  it('клик по строке ведёт к машине', async () => {
    await openWithHistory();
    fireEvent.click(rows()[0]);
    expect(location.hash).toBe('#ussr/ussr_is_2_1944');
    expect(card('ussr_is_2_1944').className).toMatch(/\bis-flash\b/);
  });

  it('изменённые за 3 часа обведены и несут бейдж «было …», более старые — нет', async () => {
    await openWithHistory();
    fireEvent.click(screen.getByRole('tab', { name: 'СССР' }));
    const is2 = card('ussr_is_2_1944');
    expect(is2.className).toMatch(/\bis-recent\b/);
    expect(is2.querySelector('.card-was')?.textContent).toBe('было 1');
    expect(card('ussr_bmp_2m').querySelector('.card-was')?.textContent).toBe('было 1');
    const t26 = card('ussr_t_26');
    expect(t26.className).not.toMatch(/\bis-recent\b/);
    expect(t26.querySelector('.card-was')).toBeNull();
  });
});
