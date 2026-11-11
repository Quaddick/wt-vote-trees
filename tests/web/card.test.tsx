import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fake, resetFake } from './fake-api';
import { card, closePage, openPage } from './harness';
import { waitFor } from '@testing-library/preact';
import { nameSize } from '../../src/format';

vi.mock('../../src/api', () => import('./fake-api'));

beforeEach(() => resetFake());
afterEach(closePage);

async function openWith(values: Record<string, { c: number } | { b: true }>) {
  fake.state = { version: 3, values, changes: [] };
  await openPage('#ussr');
  await waitFor(() => expect(card('ussr_bt_5').querySelector('.card-value, .card-cross')).toBeTruthy());
}

describe('карточка машины', () => {
  it('иконка-слот, имя, БР РБ и значение', async () => {
    await openWith({ ussr_t_34_1941: { c: 0.8 } });
    const c = card('ussr_t_34_1941');
    expect(c.querySelector('img')?.getAttribute('src')).toBe('catalog/slots/ussr_t_34_1941.webp');
    expect(c.querySelector('.card-name')?.textContent).toBe('Т-34 (1941)');
    // БР РБ — 3.7, а не АБ 4.0
    expect(c.querySelector('.card-br')?.textContent).toBe('3.7');
    expect(c.querySelector('.card-value')?.textContent).toBe('0.8');
  });

  it('машина без записи — «1»; коэффициент без хвостовых нулей', async () => {
    await openWith({ ussr_bt_5: { c: 0.5 } });
    expect(card('ussr_t_26').querySelector('.card-value')?.textContent).toBe('1');
    expect(card('ussr_bt_5').querySelector('.card-value')?.textContent).toBe('0.5');
  });

  it('блок — красный крест вместо цифры и приглушение', async () => {
    await openWith({ ussr_bt_5: { b: true } });
    const c = card('ussr_bt_5');
    expect(c.querySelector('.card-cross')?.textContent).toBe('✕');
    expect(c.querySelector('.card-value')).toBeNull();
    expect(c.className).toMatch(/\bis-blocked\b/);
    expect(card('ussr_t_26').className).not.toMatch(/\bis-blocked\b/);
  });

  it('нет БР — «—»; нет иконки — заглушка', async () => {
    await openWith({});
    expect(card('ussr_buk_launcher').querySelector('.card-br')?.textContent).toBe('—');
    const noSlot = card('ussr_t_80u_yt_cup_2019');
    expect(noSlot.querySelector('img')).toBeNull();
    expect(noSlot.querySelector('.card-noicon')).toBeTruthy();
  });

  it('название в одну строку: длинное — мельче, чтобы не уходить под цифру', async () => {
    await openWith({});
    expect(card('ussr_t_26').querySelector('.card-name')?.className).toBe('card-name');
    // «ИС-2 обр. 1944» — 14 символов
    expect(card('ussr_is_2_1944').querySelector('.card-name')?.className).toBe('card-name card-name--s');
  });
});

describe('размер названия на карточке', () => {
  it('до 13 символов — обычный, 14–17 — s, от 18 — xs', () => {
    expect(nameSize('M4A3E2 (76) W')).toBe('m');
    expect(nameSize('Ha-Go Commander')).toBe('s');
    expect(nameSize('Bfw. Jagdpanther G')).toBe('xs');
    expect(nameSize('СУ-76М (5гв.Кав.Корп)')).toBe('xs');
    expect(nameSize('FSAF SAMP/T (Mamba) (TADS)')).toBe('xs');
  });
});
