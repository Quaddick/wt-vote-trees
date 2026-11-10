/**
 * Сборка каталога деревьев наземной техники из вики War Thunder.
 *
 *   npm run catalog                — деревья en/ru, БР со страниц машин (кэш), флаги, слоты → public/catalog/trees.json
 *   npm run catalog -- --refresh   — перекачать страницы машин (БР), не глядя в кэш
 *
 * Единственное место проекта, которое ходит в сеть к вики. Рантайм читает только результат.
 * Вики недоступна или отдала не то — скрипт падает с сообщением, существующий trees.json не трогает.
 * Ключ всего — ID машины из вики: новая машина после пересборки просто появляется в дереве.
 */
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'node-html-parser';
import sharp from 'sharp';
import type { BattleRating, Cell, NationCode, NationTree, TreeCatalog, VehicleInfo } from '../../shared/types';
import { displayName } from '../../shared/values';
import { NATIONS } from './nations';
import { parseTreeLayout, type ParsedCell, type ParsedNation } from './parse-tree';
import { parseBattleRating } from './parse-unit';

export const WIKI_EN_URL = 'https://wiki.warthunder.com/ground';
export const WIKI_RU_URL = 'https://wiki-ru.warthunder.com/ground';
export const UNIT_URL = 'https://wiki.warthunder.com/unit/';
export const FLAG_URL = 'https://wiki.warthunder.com/static/country_svg/country_';
export const SLOT_URL = 'https://static.encyclopedia.warthunder.com/slots/';

const USER_AGENT = 'wt-vote-trees-catalog/1.0 (build-time only)';
/** Меньше машин в дереве — вики отдала не ту страницу (на 2026-11-10 их 1227). */
const DEFAULT_MIN_VEHICLES = 1000;
const DEFAULT_CONCURRENCY = 4;
/** Больше этой доли машин без БР — страницы машин сломаны, каталог не пишется. */
const DEFAULT_MAX_MISSING_BR = 0.05;
const SLOT_QUALITY = 85;
const RETRIES = 3;

export interface BuildOptions {
  /** Папка каталога: trees.json, slots/, flags/ */
  outDir: string;
  /** Кэш страниц машин (фрагменты с БР) */
  cacheDir: string;
  /** Готовые слоты колеса (`<id>.webp`) — копируются вместо скачивания; null — не использовать */
  wheelSlotsDir?: string | null;
  fetch?: typeof fetch;
  log?: (msg: string) => void;
  /** Одновременных запросов к вики, по умолчанию 4 */
  concurrency?: number;
  /** Нижняя граница числа машин в дереве, иначе страница считается неверной */
  minVehicles?: number;
  /** Сколько наций должно найтись на странице дерева, по умолчанию все 10 */
  minNations?: number;
  /** Допустимая доля машин без БР, по умолчанию 0.05 */
  maxMissingBrShare?: number;
  /** Не брать БР из кэша */
  refreshBr?: boolean;
  /** Пауза перед повтором запроса, мс (растёт с номером попытки), по умолчанию 300 */
  retryDelayMs?: number;
}

export interface BuildSummary {
  total: number;
  byNation: Partial<Record<NationCode, number>>;
  /** ID без БР */
  noBr: string[];
  /** ID без иконки-слота */
  noSlot: string[];
  /** Страниц машин скачано в этот запуск (остальное — из кэша) */
  unitPagesFetched: number;
  /** Слотов скопировано из колеса / скачано */
  slotsCopied: number;
  slotsDownloaded: number;
}

/** Ошибка сборки, после которой каталог не обновляется. */
export class CatalogError extends Error {
  override name = 'CatalogError';
}

type Fetched = { kind: 'ok'; res: Response } | { kind: 'missing' } | { kind: 'error'; reason: string };

/** Запрос с повторами: 404 — «нет», прочие ошибки — после трёх попыток. */
async function fetchWithRetry(url: string, fetchImpl: typeof fetch, retryDelayMs: number): Promise<Fetched> {
  let reason = '';
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT } });
      if (res.status === 404) return { kind: 'missing' };
      if (res.ok) return { kind: 'ok', res };
      reason = `HTTP ${res.status}`;
    } catch (err) {
      reason = (err as Error).message;
    }
    if (attempt < RETRIES) await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
  }
  return { kind: 'error', reason };
}

async function fetchTree(url: string, fetchImpl: typeof fetch, minVehicles: number, minNations: number) {
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT } });
  } catch (err) {
    throw new CatalogError(`Вики недоступна: ${url} — ${(err as Error).message}`);
  }
  if (!res.ok) throw new CatalogError(`Вики ответила ошибкой: ${url} → HTTP ${res.status}`);
  const nations = parseTreeLayout(await res.text());
  const vehicles = nations.reduce((s, n) => s + n.vehicles.length, 0);
  if (nations.length < minNations || vehicles < minVehicles) {
    throw new CatalogError(
      `Вики отдала не ту страницу: ${url} — наций ${nations.length} (нужно ${minNations}), ` +
        `машин ${vehicles} (нужно не меньше ${minVehicles}). Возможно, поменялась разметка дерева ` +
        '(.unit-tree[data-tree-id] / .wt-tree_rank / .wt-tree_item).',
    );
  }
  return nations;
}

/** Выполняет задачи не больше чем по `limit` одновременно. */
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await worker(items[next++]);
  });
  await Promise.all(lanes);
}

async function writeAtomic(file: string, data: string | Buffer): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

/** Безопасное имя файла кэша из ID вики. */
const cacheName = (id: string) => `${id.replace(/[^\w.-]/g, '_')}.html`;

type BrResult = { br: BattleRating | null; fetched: boolean };

/**
 * БР машины: из кэша (фрагмент `.game-unit_br` страницы), иначе со страницы `/unit/<id>`.
 * В кэш кладётся только страница, давшая БР, — пустые ответы перезапрашиваются в следующий раз.
 * Не скачалось — БР из прежнего trees.json, если был.
 */
async function loadBr(
  id: string,
  opts: {
    cacheDir: string;
    refresh: boolean;
    fetch: typeof fetch;
    retryDelayMs: number;
    previous: BattleRating | null;
    log: (m: string) => void;
  },
): Promise<BrResult> {
  const file = join(opts.cacheDir, 'units', cacheName(id));
  if (!opts.refresh && existsSync(file)) {
    const br = parseBattleRating(await readFile(file, 'utf8'));
    if (br) return { br, fetched: false };
  }
  const url = UNIT_URL + encodeURIComponent(id);
  const got = await fetchWithRetry(url, opts.fetch, opts.retryDelayMs);
  if (got.kind !== 'ok') {
    if (got.kind === 'error') opts.log(`  ! ${url}: ${got.reason}`);
    return { br: opts.previous, fetched: true };
  }
  const html = await got.res.text();
  const br = parseBattleRating(html);
  if (br) {
    const fragment = parse(html).querySelector('.game-unit_br')?.outerHTML ?? '';
    await writeAtomic(file, `<!-- ${url} -->\n${fragment}\n`);
  }
  return { br: br ?? opts.previous, fetched: true };
}

type SlotResult = 'present' | 'copied' | 'downloaded' | 'missing';

async function ensureSlot(
  id: string,
  opts: { outDir: string; wheelSlotsDir: string | null; fetch: typeof fetch; retryDelayMs: number; log: (m: string) => void },
): Promise<SlotResult> {
  const file = join(opts.outDir, 'slots', `${id}.webp`);
  if (existsSync(file)) return 'present';
  const wheel = opts.wheelSlotsDir ? join(opts.wheelSlotsDir, `${id}.webp`) : null;
  if (wheel && existsSync(wheel)) {
    await copyFile(wheel, file);
    return 'copied';
  }
  const url = `${SLOT_URL}${encodeURIComponent(id)}.png`;
  const got = await fetchWithRetry(url, opts.fetch, opts.retryDelayMs);
  if (got.kind !== 'ok') {
    if (got.kind === 'error') opts.log(`  ! ${url}: ${got.reason}`);
    return 'missing';
  }
  try {
    const webp = await sharp(Buffer.from(await got.res.arrayBuffer()))
      .webp({ quality: SLOT_QUALITY })
      .toBuffer();
    await writeAtomic(file, webp);
    return 'downloaded';
  } catch (err) {
    opts.log(`  ! ${url}: не удалось сконвертировать — ${(err as Error).message}`);
    return 'missing';
  }
}

/** Флаг нации: SVG с вики. Не скачался, но есть прежний — остаётся прежний. */
async function ensureFlag(
  code: NationCode,
  tree: string,
  outDir: string,
  fetchImpl: typeof fetch,
  retryDelayMs: number,
): Promise<void> {
  const file = join(outDir, 'flags', `${code}.svg`);
  const url = `${FLAG_URL}${tree}.svg`;
  const got = await fetchWithRetry(url, fetchImpl, retryDelayMs);
  const svg = got.kind === 'ok' ? await got.res.text() : '';
  if (svg.includes('<svg')) {
    await writeAtomic(file, svg);
    return;
  }
  if (existsSync(file)) return;
  const why = got.kind === 'ok' ? 'ответ не SVG' : got.kind === 'missing' ? 'HTTP 404' : got.reason;
  throw new CatalogError(`Не удалось скачать флаг ${code}: ${url} — ${why}`);
}

/** Удаляет слоты машин, которых больше нет в дереве. */
async function pruneSlots(dir: string, ids: Set<string>): Promise<number> {
  let removed = 0;
  for (const name of await readdir(dir)) {
    if (name.endsWith('.tmp') || !ids.has(name.replace(/\.webp$/, ''))) {
      await rm(join(dir, name), { force: true });
      removed++;
    }
  }
  return removed;
}

async function readPrevious(file: string): Promise<TreeCatalog | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as TreeCatalog;
  } catch {
    return null;
  }
}

/** Имена русской вики: машины и папки отдельно (ID «связанной» папки совпадает с ID её первой машины). */
function ruNames(ru: ParsedNation[]) {
  const vehicles = new Map<string, string>();
  const groups = new Map<string, string>();
  for (const n of ru) {
    for (const v of n.vehicles) if (v.name) vehicles.set(v.id, v.name);
    for (const r of n.ranks) {
      for (const c of [...r.research, ...r.premium].flat()) if (c?.t === 'g' && c.name) groups.set(c.id, c.name);
    }
  }
  return { vehicles, groups };
}

export async function buildCatalog(opts: BuildOptions): Promise<BuildSummary> {
  const fetchImpl = opts.fetch ?? fetch;
  const log = opts.log ?? ((m: string) => console.log(m));
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const minVehicles = opts.minVehicles ?? DEFAULT_MIN_VEHICLES;
  const minNations = opts.minNations ?? NATIONS.length;
  const maxMissingBr = opts.maxMissingBrShare ?? DEFAULT_MAX_MISSING_BR;
  const target = join(opts.outDir, 'trees.json');
  const retryDelayMs = opts.retryDelayMs ?? 300;

  log(`Скачиваю деревья: ${WIKI_EN_URL}, ${WIKI_RU_URL}`);
  const en = await fetchTree(WIKI_EN_URL, fetchImpl, minVehicles, minNations);
  const ru = await fetchTree(WIKI_RU_URL, fetchImpl, minVehicles, minNations);
  const names = ruNames(ru);

  // Раскладка — по английской вики; русская даёт только имена.
  const ordered = NATIONS.map((meta) => ({ meta, parsed: en.find((n) => n.code === meta.code) })).filter(
    (x): x is { meta: (typeof NATIONS)[number]; parsed: ParsedNation } => x.parsed !== undefined,
  );
  const seen = new Map<string, NationCode>();
  const entries: { v: ParsedNation['vehicles'][number]; nation: NationCode }[] = [];
  for (const { meta, parsed } of ordered) {
    for (const v of parsed.vehicles) {
      const other = seen.get(v.id);
      if (other) {
        log(`Внимание: ${v.id} стоит и в дереве ${other}, и в ${meta.code} — оставлено первое`);
        continue;
      }
      seen.set(v.id, meta.code);
      entries.push({ v, nation: meta.code });
    }
  }
  const noRu = entries.filter((e) => !names.vehicles.has(e.v.id)).map((e) => e.v.id);
  if (noRu.length) log(`Внимание: нет в русском дереве, nameRu = nameEn (${noRu.length}): ${noRu.join(', ')}`);
  const enIds = new Set(entries.map((e) => e.v.id));
  const ruOnly = [...names.vehicles.keys()].filter((id) => !enIds.has(id));
  if (ruOnly.length) log(`Внимание: есть только в русском дереве, пропущено (${ruOnly.length}): ${ruOnly.join(', ')}`);

  await mkdir(join(opts.outDir, 'slots'), { recursive: true });
  await mkdir(join(opts.outDir, 'flags'), { recursive: true });

  log('Флаги наций…');
  for (const { meta } of ordered) await ensureFlag(meta.code, meta.tree, opts.outDir, fetchImpl, retryDelayMs);

  const previous = await readPrevious(target);
  log(`БР со страниц машин (${entries.length}, кэш: ${join(opts.cacheDir, 'units')})…`);
  const br = new Map<string, BattleRating | null>();
  let unitPagesFetched = 0;
  let done = 0;
  await runPool(entries, concurrency, async ({ v }) => {
    const got = await loadBr(v.id, {
      cacheDir: opts.cacheDir,
      refresh: opts.refreshBr ?? false,
      fetch: fetchImpl,
      retryDelayMs,
      previous: previous?.vehicles?.[v.id]?.br ?? null,
      log,
    });
    br.set(v.id, got.br);
    if (got.fetched) unitPagesFetched++;
    if (++done % 200 === 0) log(`  ${done}/${entries.length}`);
  });
  const noBr = entries.filter((e) => !br.get(e.v.id)).map((e) => e.v.id);
  if (entries.length && noBr.length / entries.length > maxMissingBr) {
    throw new CatalogError(
      `Без БР осталось ${noBr.length} из ${entries.length} машин — страницы машин вики не отдают БР ` +
        `(.game-unit_br). Каталог не записан.`,
    );
  }

  log('Иконки-слоты…');
  const slotOpts = { outDir: opts.outDir, wheelSlotsDir: opts.wheelSlotsDir ?? null, fetch: fetchImpl, retryDelayMs, log };
  const slot = new Map<string, SlotResult>();
  await runPool(entries, concurrency, async ({ v }) => {
    slot.set(v.id, await ensureSlot(v.id, slotOpts));
  });
  const pruned = await pruneSlots(join(opts.outDir, 'slots'), enIds);
  if (pruned) log(`Удалено слотов машин, которых нет в дереве: ${pruned}`);

  const vehicles: Record<string, VehicleInfo> = {};
  for (const { v, nation } of entries) {
    const nameRu = names.vehicles.get(v.id) ?? v.name;
    vehicles[v.id] = {
      id: v.id,
      nation,
      name: displayName(nameRu, v.name),
      nameRu,
      nameEn: v.name,
      cls: v.cls,
      rank: v.rank,
      br: br.get(v.id) ?? null,
      req: v.req,
      hasSlot: slot.get(v.id) !== 'missing',
    };
  }

  const toCell = (c: ParsedCell): Cell => {
    if (c === null || c.t === 'v') return c;
    return { t: 'g', id: c.id, nameRu: names.groups.get(c.id) ?? c.name, nameEn: c.name, items: c.items, req: c.req };
  };
  const nations: NationTree[] = ordered.map(({ meta, parsed }) => ({
    code: meta.code,
    nameRu: meta.nameRu,
    flag: `flags/${meta.code}.svg`,
    researchColumns: parsed.researchColumns,
    premiumColumns: parsed.premiumColumns,
    ranks: parsed.ranks.map((r) => ({
      rank: r.rank,
      research: r.research.map((row) => row.map(toCell)),
      premium: r.premium.map((row) => row.map(toCell)),
    })),
  }));

  const catalog: TreeCatalog = { version: 1, generatedAt: new Date().toISOString(), nations, vehicles };
  await writeAtomic(target, JSON.stringify(catalog, null, 1) + '\n');

  const byNation: Partial<Record<NationCode, number>> = {};
  for (const { nation } of entries) byNation[nation] = (byNation[nation] ?? 0) + 1;
  const count = (r: SlotResult) => [...slot.values()].filter((x) => x === r).length;
  return {
    total: entries.length,
    byNation,
    noBr,
    noSlot: entries.filter((e) => slot.get(e.v.id) === 'missing').map((e) => e.v.id),
    unitPagesFetched,
    slotsCopied: count('copied'),
    slotsDownloaded: count('downloaded'),
  };
}

export function formatSummary(s: BuildSummary): string {
  const lines = [`Готово: ${s.total} машин.`, 'По нациям:'];
  for (const meta of NATIONS) {
    if (s.byNation[meta.code] !== undefined) lines.push(`  ${meta.nameRu.padEnd(15)} ${String(s.byNation[meta.code]).padStart(4)}`);
  }
  lines.push(`Страниц машин скачано: ${s.unitPagesFetched} (остальные из кэша)`);
  lines.push(`Слотов скопировано из колеса: ${s.slotsCopied}, скачано: ${s.slotsDownloaded}`);
  lines.push(`Без БР: ${s.noBr.length}${s.noBr.length ? ` — ${s.noBr.join(', ')}` : ''}`);
  lines.push(`Без слота: ${s.noSlot.length}${s.noSlot.length ? ` — ${s.noSlot.join(', ')}` : ''}`);
  return lines.join('\n');
}

/** Готовые иконки слотов — стартовый набор; папка задаётся переменной WHEEL_SLOTS_DIR, нет папки — слоты качаются из сети. */
const DEFAULT_WHEEL_SLOTS = '';

async function main(): Promise<void> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const outDir = join(root, 'public', 'catalog');
  const wheel = process.env.WHEEL_SLOTS_DIR || DEFAULT_WHEEL_SLOTS;
  try {
    const summary = await buildCatalog({
      outDir,
      cacheDir: join(root, 'scripts', 'catalog', '.cache'),
      wheelSlotsDir: existsSync(wheel) ? wheel : null,
      refreshBr: process.argv.includes('--refresh'),
    });
    console.log(formatSummary(summary));
    console.log(`Каталог записан: ${join(outDir, 'trees.json')}`);
  } catch (err) {
    const msg = err instanceof CatalogError ? err.message : `Непредвиденная ошибка: ${(err as Error).stack ?? err}`;
    console.error(`\nКаталог НЕ обновлён, существующий trees.json не тронут.\n${msg}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
