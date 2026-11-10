import { describe, expect, it } from 'vitest';
import type { NationCode, TreeCatalog, VehicleClass, VehicleInfo } from '../../shared/types';
import { matchSeed, type RawNation } from '../../scripts/seed/match';

function veh(id: string, nation: NationCode, nameEn: string, rank: number, cls: VehicleClass = 'research', nameRu = nameEn): VehicleInfo {
  return { id, nation, name: nameEn, nameRu, nameEn, cls, rank, br: null, req: null, hasSlot: true };
}

const list: VehicleInfo[] = [
  veh('il_m51', 'il', 'M-51', 4),
  veh('il_ariete', 'il', 'Ariete Certezza', 6),
  veh('il_shot_kal', 'il', "Sho't Kal No.2", 5),
  veh('il_centurion_a', 'il', 'Centurion', 3),
  veh('il_centurion_b', 'il', 'Centurion', 4),
  veh('il_magach', 'il', 'Magach', 5),
  veh('il_magach_prem', 'il', 'Magach', 5, 'premium'),
  veh('il_merkava_squad', 'il', 'Merkava Squad', 7, 'squad'),
  veh('il_twin_a', 'il', 'Twin', 2),
  veh('il_twin_b', 'il', 'Twin', 2),
  veh('il_unlisted', 'il', 'Unlisted Tank', 8),
  veh('us_sherman', 'us', 'Sherman', 3),
  veh('il_sherman', 'il', 'Sherman', 3),
  veh('il_m51_w', 'il', 'M-51 (W)', 4, 'premium'),
];

const catalog = {
  version: 1,
  generatedAt: '2026-01-01T00:00:00Z',
  nations: [],
  vehicles: Object.fromEntries(list.map((v) => [v.id, v])),
} as TreeCatalog;

function raw(items: RawNation['items']): RawNation {
  return { nation: 'il', source: 'images/IL.png', items };
}

describe('matchSeed', () => {
  it('сопоставляет точное имя и переводит значение в { c }', () => {
    const r = matchSeed(raw([{ rank: 4, section: 'research', name: 'M-51', value: '0.5' }]), catalog);
    expect(r.values['il_m51']).toEqual({ c: 0.5 });
    expect(r.unmatched).toEqual([]);
  });

  it('игнорирует регистр, пробелы и «No.» против «№»', () => {
    const r = matchSeed(
      raw([
        { rank: 6, section: 'research', name: 'ARIETE  certezza', value: '0.8' },
        { rank: 5, section: 'research', name: "Sho't Kal №2", value: '0,3' },
      ]),
      catalog,
    );
    expect(r.values['il_ariete']).toEqual({ c: 0.8 });
    expect(r.values['il_shot_kal']).toEqual({ c: 0.3 });
    expect(r.unmatched).toEqual([]);
  });

  it('«x» превращает в блок', () => {
    const r = matchSeed(raw([{ rank: 4, section: 'research', name: 'M-51', value: 'x' }]), catalog);
    expect(r.values['il_m51']).toEqual({ b: true });
  });

  it('одинаковое имя в двух рангах снимается рангом', () => {
    const r = matchSeed(raw([{ rank: 4, section: 'research', name: 'Centurion', value: '0.4' }]), catalog);
    expect(r.values['il_centurion_b']).toEqual({ c: 0.4 });
    expect(r.values['il_centurion_a']).toBeUndefined();
  });

  it('премиум и исследуемая с одним именем и рангом различаются блоком', () => {
    const r = matchSeed(
      raw([
        { rank: 5, section: 'premium', name: 'Magach', value: '0.2' },
        { rank: 5, section: 'research', name: 'Magach', value: '1' },
      ]),
      catalog,
    );
    expect(r.values['il_magach_prem']).toEqual({ c: 0.2 });
    expect(r.values['il_magach']).toEqual({ c: 1 });
  });

  it('отрядная машина стоит в премиум-блоке', () => {
    const r = matchSeed(raw([{ rank: 7, section: 'premium', name: 'Merkava Squad', value: 'x' }]), catalog);
    expect(r.values['il_merkava_squad']).toEqual({ b: true });
  });

  it('берёт машину своей нации, а не одноимённую чужую', () => {
    const r = matchSeed(raw([{ rank: 3, section: 'research', name: 'Sherman', value: '0.5' }]), catalog);
    expect(r.values['il_sherman']).toEqual({ c: 0.5 });
    expect(r.values['us_sherman']).toBeUndefined();
  });

  it('несопоставимое имя попадает в unmatched, не теряя строку', () => {
    const item = { rank: 2, section: 'research' as const, name: 'Ghost Tank', value: '0.5' };
    const r = matchSeed(raw([item]), catalog);
    expect(r.unmatched).toEqual([item]);
    expect(Object.keys(r.values)).toEqual([]);
  });

  it('имя, которое не снять ни рангом, ни блоком, — в unmatched', () => {
    const item = { rank: 2, section: 'research' as const, name: 'Twin', value: '1' };
    const r = matchSeed(raw([item]), catalog);
    expect(r.unmatched).toEqual([item]);
  });

  it('машины нации без строки — в missing, чужих наций там нет', () => {
    const r = matchSeed(raw([{ rank: 4, section: 'research', name: 'M-51', value: '1' }]), catalog);
    expect(r.missing).toContain('il_unlisted');
    expect(r.missing).not.toContain('il_m51');
    expect(r.missing).not.toContain('us_sherman');
  });

  it('неверное значение — ошибка с нацией и именем', () => {
    expect(() => matchSeed(raw([{ rank: 4, section: 'research', name: 'M-51', value: 'много' }]), catalog)).toThrow(/il.*M-51.*много/s);
  });
  it('поле id в строке raw выбирает машину напрямую: пара одноимённых получает по значению каждая', () => {
    const r = matchSeed(
      raw([
        { rank: 2, section: 'research', name: 'Twin', value: '0.5', id: 'il_twin_a' },
        { rank: 2, section: 'research', name: 'Twin', value: '0.7', id: 'il_twin_b' },
      ]),
      catalog,
    );
    expect(r.values).toEqual({ il_twin_a: { c: 0.5 }, il_twin_b: { c: 0.7 } });
    expect(r.unmatched).toEqual([]);
  });

  it('id чужой нации или несуществующий — строка в unmatched, а не тихая подмена по имени', () => {
    const foreign = { rank: 3, section: 'research' as const, name: 'Sherman', value: '1', id: 'us_sherman' };
    const ghost = { rank: 4, section: 'research' as const, name: 'M-51', value: '1', id: 'il_nope' };
    const r = matchSeed(raw([foreign, ghost]), catalog);
    expect(r.unmatched).toEqual([foreign, ghost]);
    expect(r.values).toEqual({});
  });
});
