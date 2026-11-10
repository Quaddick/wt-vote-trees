import { describe, expect, it } from 'vitest';
import type { Value, ValueMap } from './types';
import {
  applyEdit,
  DEFAULT_VALUE,
  displayName,
  formatValue,
  isValidValue,
  normalizeName,
  parseCoefficient,
  PRESETS,
  RECENT_MS,
  sameValue,
  valueOf,
} from './values';

describe('константы', () => {
  it('значение по умолчанию — коэффициент 1', () => {
    expect(DEFAULT_VALUE).toEqual({ c: 1 });
  });
  it('пресеты — 1, 0.8, 0.5, 0.4, 0.3, 0.2 и блок', () => {
    expect(PRESETS).toEqual([{ c: 1 }, { c: 0.8 }, { c: 0.5 }, { c: 0.4 }, { c: 0.3 }, { c: 0.2 }, { b: true }]);
  });
  it('«недавно» — 3 часа', () => {
    expect(RECENT_MS).toBe(3 * 60 * 60 * 1000);
  });
});

describe('valueOf', () => {
  it('нет записи — коэффициент 1', () => {
    expect(valueOf({}, 'ussr_t_34_1940')).toEqual({ c: 1 });
  });
  it('есть запись — она', () => {
    expect(valueOf({ a: { b: true } }, 'a')).toEqual({ b: true });
  });
  it('не берёт свойства прототипа', () => {
    expect(valueOf({}, 'toString')).toEqual({ c: 1 });
  });
});

describe('sameValue', () => {
  it('одинаковые коэффициенты', () => expect(sameValue({ c: 0.5 }, { c: 0.5 })).toBe(true));
  it('разные коэффициенты', () => expect(sameValue({ c: 0.5 }, { c: 0.4 })).toBe(false));
  it('блок и блок', () => expect(sameValue({ b: true }, { b: true })).toBe(true));
  it('блок и коэффициент', () => expect(sameValue({ b: true }, { c: 1 })).toBe(false));
});

describe('formatValue', () => {
  it.each([
    [{ c: 1 }, '1'],
    [{ c: 0.8 }, '0.8'],
    [{ c: 0.5 }, '0.5'],
    [{ c: 0.25 }, '0.25'],
    [{ c: 10 }, '10'],
    [{ c: 0.1 + 0.2 }, '0.3'],
    [{ b: true }, '✕'],
  ] as [Value, string][])('%j → %s', (v, s) => {
    expect(formatValue(v)).toBe(s);
  });
});

describe('parseCoefficient', () => {
  it.each([
    ['0,5', 0.5],
    ['0.5', 0.5],
    [' 1 ', 1],
    ['10', 10],
    ['0.01', 0.01],
    ['.25', 0.25],
    ['0,80', 0.8],
  ])('«%s» → %s', (input, c) => {
    expect(parseCoefficient(input)).toEqual({ ok: true, value: { c } });
  });

  it.each(['0', '11', 'abc', '', '-1', '0.001', '1e1', '0.5.5', '10.01'])('«%s» отклоняется с ошибкой по-русски', (input) => {
    const r = parseCoefficient(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/[а-яё]/i);
  });

  it('вне диапазона — текст про 0.01…10', () => {
    const r = parseCoefficient('11');
    expect(r).toEqual({ ok: false, error: 'Коэффициент — число от 0.01 до 10' });
  });
});

describe('isValidValue', () => {
  it.each([[{ c: 1 }], [{ c: 0.01 }], [{ c: 10 }], [{ c: 0.35 }], [{ b: true }]])('%j — годится', (v) => {
    expect(isValidValue(v)).toBe(true);
  });
  it.each([
    [null],
    ['1'],
    [1],
    [{}],
    [{ c: 0 }],
    [{ c: 10.5 }],
    [{ c: 0.123 }],
    [{ c: Number.NaN }],
    [{ c: '1' }],
    [{ b: false }],
    [{ c: 1, b: true }],
    [{ c: 1, x: 1 }],
  ])('%j — не годится', (v) => {
    expect(isValidValue(v)).toBe(false);
  });
});

describe('applyEdit', () => {
  it('ставит значение и возвращает изменившиеся машины с «было»', () => {
    const values: ValueMap = { a: { c: 0.5 } };
    const r = applyEdit(values, { ids: ['a', 'b'], to: { b: true } });
    expect(r.values).toEqual({ a: { b: true }, b: { b: true } });
    expect(r.items).toEqual([
      { id: 'a', from: { c: 0.5 }, to: { b: true } },
      { id: 'b', from: { c: 1 }, to: { b: true } },
    ]);
  });

  it('не мутирует вход', () => {
    const values: ValueMap = { a: { c: 0.5 } };
    const snapshot = structuredClone(values);
    const edit = { ids: ['a'], to: { c: 0.2 } };
    applyEdit(values, edit);
    expect(values).toEqual(snapshot);
    expect(edit).toEqual({ ids: ['a'], to: { c: 0.2 } });
  });

  it('неизменившиеся машины в items не попадают', () => {
    const values: ValueMap = { a: { c: 0.5 }, b: { b: true } };
    const r = applyEdit(values, { ids: ['a', 'b', 'c'], to: { c: 0.5 } });
    expect(r.items.map((i) => i.id)).toEqual(['b', 'c']);
  });

  it('машина без записи и «1» — ничего не меняется', () => {
    const r = applyEdit({}, { ids: ['x'], to: { c: 1 } });
    expect(r.items).toEqual([]);
  });

  it('повтор ID в правке — одна запись', () => {
    const r = applyEdit({}, { ids: ['x', 'x'], to: { c: 0.3 } });
    expect(r.items).toHaveLength(1);
  });

  it('неверное значение — ошибка', () => {
    expect(() => applyEdit({}, { ids: ['x'], to: { c: 0 } })).toThrow();
  });
});

describe('normalizeName', () => {
  it('регистр, пробелы, дефисы, точки', () => {
    expect(normalizeName('T-34-85 (D-5T)')).toBe(normalizeName('t 34 85 (d5t)'));
  });
  it('ё → е', () => {
    expect(normalizeName('Ёж')).toBe('еж');
  });
  it('№ и No. — одно и то же', () => {
    expect(normalizeName('Pz.Kpfw. № 4')).toBe(normalizeName('PzKpfw No. 4'));
  });
  it('кавычки убираются', () => {
    expect(normalizeName('«Объект» "279"')).toBe('объект279');
  });
});

describe('displayName (G01)', () => {
  it.each([
    ['Т-34', 'T-34', 'Т-34'],
    ['Объект 279', 'Object 279', 'Объект 279'],
    ['2С19-М2', '2S19-M2', '2С19-М2'],
    ['Ariete Сertezza', 'Ariete Certezza', 'Ariete Certezza'],
    ['M-51', 'M-51', 'M-51'],
    ['FSAF SAMP/T (Mamba) (TEL)', 'FSAF SAMP/T (Mamba) (TEL)', 'FSAF SAMP/T (Mamba) (TEL)'],
    ['', 'M-51', 'M-51'],
  ])('ru «%s», en «%s» → «%s»', (ru, en, shown) => {
    expect(displayName(ru, en)).toBe(shown);
  });
});
