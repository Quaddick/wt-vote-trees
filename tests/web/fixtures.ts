/** Маленький каталог для компонентных тестов: СССР (2 ранга) и Израиль (1 ранг). */
import type { TreeCatalog, VehicleInfo } from '../../shared/types';

type V = Omit<VehicleInfo, 'name'> & { name?: string };

function vehicle(v: V): VehicleInfo {
  return { name: v.nameRu, ...v };
}

export function fixtureCatalog(): TreeCatalog {
  const list: VehicleInfo[] = [
    vehicle({ id: 'ussr_t_26', nation: 'ussr', nameRu: 'Т-26', nameEn: 'T-26', cls: 'research', rank: 1, br: { ab: 1, rb: 1, sb: 1 }, req: null, hasSlot: true }),
    vehicle({ id: 'ussr_bt_5', nation: 'ussr', nameRu: 'БТ-5', nameEn: 'BT-5', cls: 'research', rank: 1, br: { ab: 1.3, rb: 1.3, sb: 1.3 }, req: null, hasSlot: true }),
    vehicle({ id: 'ussr_t_34_1940', nation: 'ussr', nameRu: 'Т-34 (1940)', nameEn: 'T-34 (1940)', cls: 'research', rank: 1, br: { ab: 3.7, rb: 3.7, sb: 3.7 }, req: 'ussr_t_26', hasSlot: true }),
    vehicle({ id: 'ussr_t_34_1941', nation: 'ussr', nameRu: 'Т-34 (1941)', nameEn: 'T-34 (1941)', cls: 'research', rank: 1, br: { ab: 4, rb: 3.7, sb: 3.7 }, req: 'ussr_t_34_1940', hasSlot: true }),
    vehicle({ id: 'ussr_is_2_1944', nation: 'ussr', nameRu: 'ИС-2 обр. 1944', nameEn: 'IS-2 mod.1944', cls: 'research', rank: 2, br: { ab: 6.7, rb: 6.7, sb: 6.3 }, req: 'ussr_t_34_group', hasSlot: true }),
    vehicle({ id: 'ussr_buk_launcher', nation: 'ussr', nameRu: 'Бук ПУ', nameEn: 'Buk TEL', cls: 'research', rank: 2, br: null, req: null, hasSlot: true }),
    vehicle({ id: 'ussr_t_80u_yt_cup_2019', nation: 'ussr', nameRu: 'Т-80У', nameEn: 'T-80U', cls: 'premium', rank: 2, br: { ab: 10.7, rb: 10.7, sb: 10.7 }, req: null, hasSlot: false }),
    vehicle({ id: 'ussr_bmp_2m', nation: 'ussr', nameRu: 'БМП-2М', nameEn: 'BMP-2M', cls: 'squad', rank: 1, br: { ab: 2.7, rb: 2.7, sb: 2.7 }, req: null, hasSlot: true }),
    vehicle({ id: 'il_m_51', nation: 'il', nameRu: 'M-51', nameEn: 'M-51', cls: 'research', rank: 4, br: { ab: 6.3, rb: 6.3, sb: 6.3 }, req: null, hasSlot: true }),
    vehicle({ id: 'il_sholef', nation: 'il', nameRu: 'Sholef', nameEn: 'Sholef', cls: 'premium', rank: 4, br: { ab: 7.3, rb: 7.3, sb: 7.3 }, req: null, hasSlot: true }),
    vehicle({ id: 'il_t_34', nation: 'il', nameRu: 'Т-34 (Израиль)', nameEn: 'T-34 (Israel)', cls: 'research', rank: 4, br: { ab: 4, rb: 4, sb: 4 }, req: 'il_m_51', hasSlot: true }),
  ];
  return {
    version: 1,
    generatedAt: '2026-11-10T00:00:00.000Z',
    nations: [
      {
        code: 'ussr',
        nameRu: 'СССР',
        flag: 'flags/ussr.svg',
        researchColumns: 2,
        premiumColumns: 1,
        ranks: [
          {
            rank: 1,
            research: [
              [{ t: 'v', id: 'ussr_t_26' }, { t: 'v', id: 'ussr_bt_5' }],
              [{ t: 'g', id: 'ussr_t_34_group', nameRu: 'Т-34', nameEn: 'T-34', items: ['ussr_t_34_1940', 'ussr_t_34_1941'], req: 'ussr_t_26' }, null],
            ],
            premium: [[{ t: 'v', id: 'ussr_bmp_2m' }], [null]],
          },
          {
            rank: 2,
            research: [[{ t: 'v', id: 'ussr_is_2_1944' }, { t: 'v', id: 'ussr_buk_launcher' }]],
            premium: [[{ t: 'v', id: 'ussr_t_80u_yt_cup_2019' }]],
          },
        ],
      },
      {
        code: 'il',
        nameRu: 'Израиль',
        flag: 'flags/il.svg',
        researchColumns: 1,
        premiumColumns: 1,
        ranks: [
          {
            rank: 4,
            research: [[{ t: 'v', id: 'il_m_51' }], [{ t: 'v', id: 'il_t_34' }]],
            premium: [[{ t: 'v', id: 'il_sholef' }], [null]],
          },
        ],
      },
    ],
    vehicles: Object.fromEntries(list.map((v) => [v.id, v])),
  };
}
