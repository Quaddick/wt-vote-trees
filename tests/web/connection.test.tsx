process.env.TZ = 'UTC';

import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { start } from '../../src/state';
import { fake, fetchState, resetFake } from './fake-api';
import { card } from './harness';

vi.mock('../../src/api', () => import('./fake-api'));

const T0 = Date.parse('2026-11-10T12:00:00Z');
let stop: () => void;

beforeEach(() => {
  resetFake();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  history.replaceState(null, '', '/#ussr');
});
afterEach(() => {
  stop?.();
  cleanup();
  vi.useRealTimers();
});

async function open() {
  stop = start();
  render(<App />);
  await vi.advanceTimersByTimeAsync(0);
}

const banner = () => screen.queryByRole('alert');
const calls = () => fetchState.mock.calls.length;

describe('опрос сервера и плашка связи', () => {
  it('опрос раз в 10 с с ETag; новые значения перерисовываются без пересоздания карточек', async () => {
    fake.state = { version: 1, values: { ussr_t_26: { c: 0.8 } }, changes: [] };
    await open();
    expect(calls()).toBe(1);
    const before = card('ussr_t_26');
    expect(before.getAttribute('data-value')).toBe('0.8');

    await vi.advanceTimersByTimeAsync(9_999);
    expect(calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls()).toBe(2);
    expect(fetchState.mock.calls[1][0]).toBe('"1"');

    fake.state = { version: 2, values: { ussr_t_26: { c: 0.5 } }, changes: [] };
    await vi.advanceTimersByTimeAsync(10_000);
    expect(card('ussr_t_26').getAttribute('data-value')).toBe('0.5');
    expect(card('ussr_t_26')).toBe(before);
    expect(banner()).toBeNull();
  });

  it('ошибка — плашка со временем последних значений, паузы 10→20→40→60 с, восстановление убирает плашку', async () => {
    await open(); // успех в 12:00:00
    fake.down = true;
    await vi.advanceTimersByTimeAsync(10_000); // 1-я ошибка в 12:00:10
    expect(calls()).toBe(2);
    expect(banner()?.textContent).toBe('Нет связи с сервером — значения на 12:00');

    for (const pause of [10_000, 20_000, 40_000, 60_000, 60_000]) {
      const n = calls();
      await vi.advanceTimersByTimeAsync(pause - 1);
      expect(calls()).toBe(n);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls()).toBe(n + 1);
    }
    expect(banner()).not.toBeNull();

    fake.down = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(banner()).toBeNull();
    // после восстановления — снова раз в 10 с
    const n = calls();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls()).toBe(n + 1);
  });

  it('сервер недоступен с самого начала — дерево со значениями «1» и плашка', async () => {
    fake.down = true;
    await open();
    expect(banner()?.textContent).toMatch(/^Нет связи с сервером/);
    expect(card('ussr_t_26').getAttribute('data-value')).toBe('1');
  });
});
