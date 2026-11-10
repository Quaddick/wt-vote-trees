import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TreeCatalog } from '../../shared/types';
import { buildCatalog, CatalogError, type BuildOptions } from './build-catalog';

const fixture = (name: string) => readFileSync(join(import.meta.dirname, '__fixtures__', name), 'utf8');

const EN = 'https://wiki.warthunder.com/ground';
const RU = 'https://wiki-ru.warthunder.com/ground';

let png: Buffer;
beforeAll(async () => {
  png = await sharp({ create: { width: 4, height: 4, channels: 4, background: '#888' } })
    .png()
    .toBuffer();
});

interface FakeWiki {
  en: string;
  ru: string;
  /** Ответ страницы машины */
  unit: (id: string) => Response;
  /** ID машин без иконки-слота (404) */
  noSlot?: string[];
}

/** Подменённый fetch: отвечает фикстурами и записывает, что спрашивали. */
function fakeFetch(wiki: FakeWiki) {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    if (url === EN) return new Response(wiki.en);
    if (url === RU) return new Response(wiki.ru);
    const unit = url.match(/^https:\/\/wiki\.warthunder\.com\/unit\/(.+)$/);
    if (unit) return wiki.unit(unit[1]);
    if (/\/static\/country_svg\/country_\w+\.svg$/.test(url)) {
      return new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"></svg>');
    }
    const slot = url.match(/\/slots\/(.+)\.png$/);
    if (slot) return wiki.noSlot?.includes(slot[1]) ? new Response('', { status: 404 }) : new Response(new Uint8Array(png));
    return new Response('', { status: 404 });
  }) as typeof fetch;
  return { fn, calls, unitCalls: () => calls.filter((u) => u.includes('/unit/')) };
}

const unitPage = () => new Response(fixture('unit_il_m_51.html'));

let dir: string;
let outDir: string;
let cacheDir: string;
let wheelDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wtv-catalog-'));
  outDir = join(dir, 'catalog');
  cacheDir = join(dir, 'cache');
  wheelDir = join(dir, 'wheel-slots');
  mkdirSync(wheelDir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const options = (fetchImpl: typeof fetch, extra: Partial<BuildOptions> = {}): BuildOptions => ({
  outDir,
  cacheDir,
  wheelSlotsDir: wheelDir,
  fetch: fetchImpl,
  log: () => {},
  minVehicles: 10,
  minNations: 2,
  retryDelayMs: 0,
  ...extra,
});

const readCatalog = (): TreeCatalog => JSON.parse(readFileSync(join(outDir, 'trees.json'), 'utf8'));

describe('buildCatalog — сбой вики не трогает существующий каталог', () => {
  const OLD = '{"version":1,"old":true}\n';
  beforeEach(() => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'trees.json'), OLD);
  });

  it('вики недоступна → CatalogError с понятным текстом', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    await expect(buildCatalog(options(down))).rejects.toThrow(CatalogError);
    await expect(buildCatalog(options(down))).rejects.toThrow(/Вики недоступна/);
    expect(readFileSync(join(outDir, 'trees.json'), 'utf8')).toBe(OLD);
  });

  it('вики ответила ошибкой HTTP', async () => {
    const err = (async () => new Response('', { status: 503 })) as typeof fetch;
    await expect(buildCatalog(options(err))).rejects.toThrow(/HTTP 503/);
    expect(readFileSync(join(outDir, 'trees.json'), 'utf8')).toBe(OLD);
  });

  it('вики отдала не ту страницу (нет деревьев)', async () => {
    const wrong = fakeFetch({ en: '<html><body>Maintenance</body></html>', ru: fixture('ground_ru.html'), unit: unitPage });
    await expect(buildCatalog(options(wrong.fn))).rejects.toThrow(/не ту страницу/);
    expect(readFileSync(join(outDir, 'trees.json'), 'utf8')).toBe(OLD);
  });

  it('страницы машин не отдают БР → ошибка, каталог цел', async () => {
    const noBr = fakeFetch({
      en: fixture('ground_en.html'),
      ru: fixture('ground_ru.html'),
      unit: () => new Response('', { status: 500 }),
    });
    await expect(buildCatalog(options(noBr.fn))).rejects.toThrow(/БР/);
    expect(readFileSync(join(outDir, 'trees.json'), 'utf8')).toBe(OLD);
  });
});

describe('buildCatalog — сборка с фикстур', () => {
  // В русской вики советская машина подписана кириллицей — подставляем, чтобы проверить правило G01.
  const ru = fixture('ground_ru.html').replace('<span>ZSU-57-2</span>', '<span>ЗСУ-57-2</span>');

  it('пишет trees.json: нации по порядку вкладок, раскладка, машины с именами, БР, слотами', async () => {
    writeFileSync(join(wheelDir, 'il_m_51.webp'), await sharp(png).webp().toBuffer());
    const wiki = fakeFetch({ en: fixture('ground_en.html'), ru, unit: unitPage, noSlot: ['il_sholef'] });
    const summary = await buildCatalog(options(wiki.fn));
    const cat = readCatalog();

    expect(cat.version).toBe(1);
    expect(Number.isNaN(Date.parse(cat.generatedAt))).toBe(false);
    expect(cat.nations.map((n) => n.code)).toEqual(['us', 'il']);
    const il = cat.nations[1];
    expect(il).toMatchObject({ nameRu: 'Израиль', flag: 'flags/il.svg', researchColumns: 4, premiumColumns: 1 });
    expect(il.ranks.map((r) => r.rank)).toEqual([4, 5, 6]);
    expect(il.ranks[0].research[1][0]).toEqual({
      t: 'g',
      id: 'il_magach_1_2_group',
      nameRu: 'Magach 1/2',
      nameEn: 'Magach 1/2',
      items: ['il_m48a1_patton_iii', 'il_magach_2'],
      req: 'il_m_51',
    });
    const usCells = cat.nations[0].ranks.flatMap((r) => r.premium.flat());
    expect(usCells).toContainEqual(expect.objectContaining({ id: 'us_kit_3rank_group', nameRu: 'Ад на Колёсах', nameEn: 'Hell on Wheels' }));

    expect(cat.vehicles.il_m_51).toEqual({
      id: 'il_m_51',
      nation: 'il',
      name: 'M-51',
      nameRu: 'M-51',
      nameEn: 'M-51',
      cls: 'research',
      rank: 4,
      br: { ab: 6.3, rb: 6.3, sb: 6.3 },
      req: null,
      hasSlot: true,
    });
    expect(cat.vehicles.il_zsu_57_2).toMatchObject({ name: 'ЗСУ-57-2', nameRu: 'ЗСУ-57-2', nameEn: 'ZSU-57-2' });
    expect(cat.vehicles.us_sl_amraam_fcs).toMatchObject({ name: 'CLAWS (TADS)', nameRu: 'CLAWS (СОЦ)' });
    expect(cat.vehicles.il_sholef.hasSlot).toBe(false);

    expect(existsSync(join(outDir, 'flags', 'il.svg'))).toBe(true);
    expect(existsSync(join(outDir, 'flags', 'us.svg'))).toBe(true);
    expect(existsSync(join(outDir, 'slots', 'il_aml_90.webp'))).toBe(true);
    // Слот из колеса скопирован, а не скачан
    expect(wiki.calls.some((u) => u.endsWith('/slots/il_m_51.png'))).toBe(false);

    expect(summary.total).toBe(Object.keys(cat.vehicles).length);
    expect(summary.noSlot).toEqual(['il_sholef']);
    expect(summary.noBr).toEqual([]);
  });

  it('повторный запуск не качает страницы машин заново; новая машина просто появляется', async () => {
    const first = fakeFetch({ en: fixture('ground_en.html'), ru, unit: unitPage });
    await buildCatalog(options(first.fn));
    const ids = Object.keys(readCatalog().vehicles);
    expect(first.unitCalls()).toHaveLength(ids.length);

    const second = fakeFetch({ en: fixture('ground_en.html'), ru, unit: unitPage });
    await buildCatalog(options(second.fn));
    expect(second.unitCalls()).toEqual([]);

    // На вики появилась машина il_tcm_20_new (на месте il_tcm_20)
    const swap = (s: string) => s.replaceAll('"il_tcm_20"', '"il_tcm_20_new"');
    const third = fakeFetch({ en: swap(fixture('ground_en.html')), ru: swap(ru), unit: unitPage });
    await buildCatalog(options(third.fn));
    expect(third.unitCalls()).toEqual(['https://wiki.warthunder.com/unit/il_tcm_20_new']);
    const cat = readCatalog();
    expect(cat.vehicles.il_tcm_20_new).toMatchObject({ nation: 'il', rank: 4, br: { ab: 6.3, rb: 6.3, sb: 6.3 } });
    expect(cat.vehicles.il_tcm_20).toBeUndefined();
    expect(cat.nations[1].ranks[0].research[0][2]).toEqual({ t: 'v', id: 'il_tcm_20_new' });
  });
});
