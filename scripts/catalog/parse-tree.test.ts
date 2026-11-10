import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanName, parseTreeLayout, type ParsedNation } from './parse-tree';

const fixture = (name: string) => readFileSync(join(import.meta.dirname, '__fixtures__', name), 'utf8');

// Ожидания разобраны вручную по вырезке страницы https://wiki.warthunder.com/ground (2026-11-10).
describe('parseTreeLayout — английская вики', () => {
  const nations = parseTreeLayout(fixture('ground_en.html'));
  const byCode = (code: string): ParsedNation => {
    const n = nations.find((x) => x.code === code);
    if (!n) throw new Error(`нет нации ${code}`);
    return n;
  };
  const vehicle = (n: ParsedNation, id: string) => n.vehicles.find((v) => v.id === id);

  it('берёт только известные деревья наций, пустой usa-copy пропускает', () => {
    expect(nations.map((n) => [n.code, n.tree])).toEqual([
      ['il', 'israel'],
      ['us', 'usa'],
    ]);
  });

  it('ранги по подписи «Rank IV» и число колонок блоков', () => {
    const il = byCode('il');
    expect(il.ranks.map((r) => r.rank)).toEqual([4, 5, 6]);
    expect(il.researchColumns).toBe(4);
    expect(il.premiumColumns).toBe(1);
    const us = byCode('us');
    expect(us.ranks.map((r) => r.rank)).toEqual([3, 8]);
    expect(us.researchColumns).toBe(5);
    expect(us.premiumColumns).toBe(2);
  });

  it('исследуемый блок ранга: строки × колонки, пустые ячейки, группы', () => {
    const rank4 = byCode('il').ranks[0];
    expect(rank4.research).toEqual([
      [
        { t: 'v', id: 'il_m_51' },
        { t: 'v', id: 'il_amx_13_75' },
        { t: 'v', id: 'il_tcm_20' },
        { t: 'v', id: 'il_m109' },
      ],
      [
        { t: 'g', id: 'il_magach_1_2_group', name: 'Magach 1/2', items: ['il_m48a1_patton_iii', 'il_magach_2'], req: 'il_m_51' },
        { t: 'v', id: 'il_aml_90' },
        { t: 'v', id: 'il_zsu_57_2' },
        { t: 'g', id: 'il_rochev_tager_group', name: 'Rochev/Tager', items: ['il_m109a1', 'il_ss_11_halftrack'], req: 'il_m109' },
      ],
      [null, { t: 'v', id: 'il_centurion_mk_5_shot' }, { t: 'v', id: 'il_m163_vulcan' }, null],
    ]);
  });

  it('премиумный блок ранга', () => {
    expect(byCode('il').ranks[0].premium).toEqual([[{ t: 'v', id: 'il_m_51_w' }], [{ t: 'v', id: 'il_sholef' }], [null]]);
  });

  it('все строки блока одной длины — по числу колонок нации', () => {
    for (const n of nations) {
      for (const r of n.ranks) {
        for (const row of r.research) expect(row).toHaveLength(n.researchColumns);
        for (const row of r.premium) expect(row).toHaveLength(n.premiumColumns);
      }
    }
  });

  it('машины: класс, ранг, req, очищенное имя', () => {
    const il = byCode('il');
    expect(vehicle(il, 'il_m_51')).toEqual({ id: 'il_m_51', name: 'M-51', cls: 'research', rank: 4, req: null });
    expect(vehicle(il, 'il_aml_90')).toEqual({ id: 'il_aml_90', name: 'AML-90', cls: 'research', rank: 4, req: 'il_amx_13_75' });
    expect(vehicle(il, 'il_magach_2')).toMatchObject({ rank: 4, req: 'il_m48a1_patton_iii', cls: 'research' });
    expect(vehicle(il, 'il_m_51_w')).toMatchObject({ name: 'M-51 (W)', cls: 'premium', rank: 4 });
    expect(vehicle(il, 'il_magach_6b_gal')).toMatchObject({ name: 'Magach 6B Gal', cls: 'squad', rank: 6 });
    // req ведёт и на группу
    expect(vehicle(il, 'il_m113_hvms')).toMatchObject({ rank: 5, req: 'il_rochev_tager_group' });
  });

  it('первая машина группы без своего req исследуется от того же, что и группа', () => {
    expect(vehicle(byCode('il'), 'il_m48a1_patton_iii')).toMatchObject({ req: 'il_m_51' });
  });

  it('машина в премиумном блоке без пометки премиума — премиумная', () => {
    expect(vehicle(byCode('us'), 'us_m24_chaffee_tl')).toMatchObject({ cls: 'premium', rank: 3, name: 'M24 (TL)' });
  });

  it('премиумная группа и «связанная» группа с ID первой машины', () => {
    const us = byCode('us');
    const cells = us.ranks.flatMap((r) => [...r.research, ...r.premium].flat());
    expect(cells).toContainEqual(expect.objectContaining({ t: 'g', id: 'us_kit_3rank_group', name: 'Hell on Wheels', req: null }));
    expect(cells).toContainEqual({
      t: 'g',
      id: 'us_sl_amraam_fcs',
      name: 'CLAWS',
      items: ['us_sl_amraam_fcs', 'us_sl_amraam_launcher'],
      req: 'us_adats_bradley',
    });
    expect(vehicle(us, 'us_sl_amraam_fcs')).toMatchObject({ name: 'CLAWS (TADS)', rank: 8, req: 'us_adats_bradley' });
    expect(vehicle(us, 'us_skink_aa_kit_3rank')).toMatchObject({ name: 'Skink (Hell)', cls: 'premium' });
  });

  it('каждая машина — ровно один раз и стоит в ячейке', () => {
    for (const n of nations) {
      const ids = n.vehicles.map((v) => v.id);
      expect(new Set(ids).size).toBe(ids.length);
      const placed = n.ranks.flatMap((r) =>
        [...r.research, ...r.premium].flat().flatMap((c) => (c === null ? [] : c.t === 'v' ? [c.id] : c.items)),
      );
      expect(placed.sort()).toEqual([...ids].sort());
    }
  });
});

describe('parseTreeLayout — русская вики', () => {
  it('имена русской вики: группа и подпись машины', () => {
    const us = parseTreeLayout(fixture('ground_ru.html')).find((n) => n.code === 'us');
    const cells = us!.ranks.flatMap((r) => [...r.research, ...r.premium].flat());
    expect(cells).toContainEqual(expect.objectContaining({ id: 'us_kit_3rank_group', name: 'Ад на Колёсах' }));
    expect(us!.vehicles.find((v) => v.id === 'us_sl_amraam_fcs')?.name).toBe('CLAWS (СОЦ)');
  });
});

describe('parseTreeLayout — не та страница', () => {
  it('нет деревьев — пустой список', () => {
    expect(parseTreeLayout('<html><body><h1>Maintenance</h1></body></html>')).toEqual([]);
  });
});

describe('cleanName', () => {
  it('убирает глифы игрового шрифта и неразрывные пробелы', () => {
    expect(cleanName('ZSU-57-2')).toBe('ZSU-57-2');
    expect(cleanName('▃Skink (Hell)')).toBe('Skink (Hell)');
    expect(cleanName('  Pz.Kpfw. № 4  ')).toBe('Pz.Kpfw. № 4');
  });
});
