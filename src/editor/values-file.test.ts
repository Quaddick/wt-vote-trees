import { describe, expect, it } from 'vitest';
import { exportFileName, importEdits, parseValuesFile, serializeValues } from './values-file';

describe('файл значений', () => {
  it('имя файла — wt-values-ГГГГ-ММ-ДД.json по местной дате', () => {
    expect(exportFileName(new Date(2026, 0, 5, 23, 59))).toBe('wt-values-2026-01-05.json');
    expect(exportFileName(new Date(2026, 10, 10, 0, 1))).toBe('wt-values-2026-11-10.json');
  });

  it('выгрузка содержит значение каждой машины каталога, «1» — явно', () => {
    const text = serializeValues({ a_tank: { c: 0.5 }, gone_tank: { b: true } }, ['a_tank', 'b_tank'], new Date(0));
    const parsed = JSON.parse(text) as { values: Record<string, unknown> };
    expect(parsed.values).toEqual({ a_tank: { c: 0.5 }, b_tank: { c: 1 }, gone_tank: { b: true } });
  });

  it('выгруженный файл читается обратно', () => {
    const text = serializeValues({ a_tank: { c: 0.25 }, b_tank: { b: true } }, ['a_tank', 'b_tank'], new Date(0));
    expect(parseValuesFile(text)).toEqual({ a_tank: { c: 0.25 }, b_tank: { b: true } });
  });

  it('голая карта значений (как data/seed/values.json) тоже принимается', () => {
    expect(parseValuesFile('{"a_tank":{"c":0.8},"b_tank":{"b":true}}')).toEqual({
      a_tank: { c: 0.8 },
      b_tank: { b: true },
    });
  });

  it.each([
    ['не JSON', 'hello'],
    ['массив', '[1,2]'],
    ['пустой объект', '{}'],
    ['пустые values', '{"values":{}}'],
    ['коэффициент вне диапазона', '{"a_tank":{"c":11}}'],
    ['ноль', '{"a_tank":{"c":0}}'],
    ['три знака', '{"a_tank":{"c":0.125}}'],
    ['чужая форма значения', '{"a_tank":5}'],
    ['плохой ID', '{"a tank":{"c":1}}'],
    ['__proto__', '{"__proto__":{"c":1}}'],
    ['чужой файл', '{"name":"wt-vote-trees","version":"0.1.0"}'],
  ])('битый файл (%s) → null', (_, text) => {
    expect(parseValuesFile(text)).toBeNull();
  });

  it('правки импорта: только реально меняющиеся машины, сгруппированные по значению', () => {
    const current = { a: { c: 0.5 }, b: { b: true as const }, c: { c: 1 } };
    const incoming = { a: { c: 0.5 }, b: { c: 1 }, c: { b: true as const }, d: { b: true as const }, e: { c: 1 } };
    const { edits, count } = importEdits(current, incoming);
    expect(count).toBe(3);
    const byValue = Object.fromEntries(edits.map((e) => [JSON.stringify(e.to), [...e.ids].sort()]));
    expect(byValue).toEqual({ '{"c":1}': ['b'], '{"b":true}': ['c', 'd'] });
  });

  it('ничего не меняется — пустой список правок', () => {
    expect(importEdits({ a: { c: 0.5 } }, { a: { c: 0.5 }, b: { c: 1 } })).toEqual({ edits: [], count: 0 });
  });
});
