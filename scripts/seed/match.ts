/**
 * Стартовые значения: сопоставление расшифровки скриншотов с каталогом.
 *
 *   npm run seed   — data/seed/raw/<nation>.json + public/catalog/trees.json → data/seed/values.json + docs/seed-report.md
 *
 * Сопоставление — по имени внутри нации (normalizeName); неоднозначность снимается рангом и блоком
 * (исследуемая / премиум+отрядная). Ничего не угадывает: что не сопоставилось, попадает в отчёт.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { NationCode, TreeCatalog, Value, ValueMap, VehicleInfo } from '../../shared/types';
import { normalizeName, parseCoefficient } from '../../shared/values';
import { buildReport, type NationReport, type VerifyReport } from './report';

export interface RawItem {
  rank: number;
  section: 'research' | 'premium';
  name: string;
  value: string;
  /** Необязательно: сомнение читателя скриншота, уходит в отчёт как спорное место. */
  doubt?: string;
  /** Необязательно: ID машины каталога. Приоритетнее имени; нужен для одноимённых машин в одном ранге и блоке. */
  id?: string;
}

export interface RawNation {
  nation: string;
  source?: string;
  items: RawItem[];
}

/** Что не сошлось чисто: строка сопоставлена, но по ней есть оговорка. */
export interface SeedIssue {
  kind: 'rank-mismatch' | 'section-mismatch' | 'duplicate';
  item: RawItem;
  id: string;
  note: string;
}

export interface MatchResult {
  values: ValueMap;
  /** Строки raw, которым не нашлась машина (или нашлось несколько). */
  unmatched: RawItem[];
  /** ID машин нации в каталоге, у которых на скриншоте нет строки (получат «1»). */
  missing: string[];
  /** Сопоставленные строки с ID машины. */
  matched: { item: RawItem; id: string }[];
  issues: SeedIssue[];
}

const SECTIONS = ['research', 'premium'] as const;

/** «x» (латиницей или кириллицей) — блок; остальное — коэффициент по правилам сайта. */
function parseRawValue(raw: RawNation, item: RawItem): Value {
  const text = String(item.value).trim();
  if (/^[xх]$/i.test(text)) return { b: true };
  const parsed = parseCoefficient(text);
  if (!parsed.ok) {
    throw new Error(`Нация ${raw.nation}, «${item.name}» (ранг ${item.rank}): неверное значение «${item.value}» — ${parsed.error}`);
  }
  return parsed.value;
}

function sectionOf(v: VehicleInfo): 'research' | 'premium' {
  return v.cls === 'research' ? 'research' : 'premium';
}

function checkItem(raw: RawNation, item: RawItem): void {
  const where = `Нация ${raw.nation}, «${String(item.name)}»`;
  if (typeof item.name !== 'string' || item.name.trim() === '') throw new Error(`Нация ${raw.nation}: у строки нет имени`);
  if (!Number.isInteger(item.rank) || item.rank < 1 || item.rank > 8) throw new Error(`${where}: ранг должен быть целым 1..8, а не ${String(item.rank)}`);
  if (!SECTIONS.includes(item.section)) throw new Error(`${where}: section должен быть research или premium, а не ${String(item.section)}`);
}

export function matchSeed(raw: RawNation, catalog: TreeCatalog): MatchResult {
  const nationVehicles = Object.values(catalog.vehicles).filter((v) => v.nation === (raw.nation as NationCode));
  const byName = new Map<string, VehicleInfo[]>();
  for (const v of nationVehicles) {
    // Английское имя — основной ключ; русское и показываемое — на случай, когда скриншот читали по-русски.
    for (const key of new Set([normalizeName(v.nameEn), normalizeName(v.nameRu), normalizeName(v.name)])) {
      if (key === '') continue;
      const bucket = byName.get(key);
      if (bucket) bucket.push(v);
      else byName.set(key, [v]);
    }
  }

  const values: ValueMap = {};
  const unmatched: RawItem[] = [];
  const matched: { item: RawItem; id: string }[] = [];
  const issues: SeedIssue[] = [];

  for (const item of raw.items) {
    checkItem(raw, item);
    const value = parseRawValue(raw, item);

    const candidates = [...new Set(byName.get(normalizeName(item.name)) ?? [])];
    let pick: VehicleInfo | undefined;
    let note: SeedIssue | undefined;

    const exact = candidates.filter((v) => v.rank === item.rank && sectionOf(v) === item.section);
    if (item.id !== undefined) {
      // Явный ID: только машина этой нации; чужой или несуществующий — в unmatched, без подмены по имени.
      pick = nationVehicles.find((v) => v.id === item.id);
    } else if (exact.length === 1) pick = exact[0];
    else if (exact.length === 0 && candidates.length === 1) {
      // Имя однозначно, а ранг или блок в raw не сходятся с каталогом: берём, но выносим в спорные.
      pick = candidates[0];
      const sameRank = pick.rank === item.rank;
      note = {
        kind: sameRank ? 'section-mismatch' : 'rank-mismatch',
        item,
        id: pick.id,
        note: `в каталоге: ранг ${pick.rank}, ${sectionOf(pick) === 'research' ? 'исследуемая' : 'премиум/отряд'}`,
      };
    }

    if (!pick) {
      unmatched.push(item);
      continue;
    }
    if (note) issues.push(note);
    if (pick.id in values) {
      const same = JSON.stringify(values[pick.id]) === JSON.stringify(value);
      issues.push({
        kind: 'duplicate',
        item,
        id: pick.id,
        note: same ? 'строка повторяет уже перенесённую с тем же значением' : 'значение расходится с уже перенесённой строкой; оставлено первое',
      });
      continue;
    }
    values[pick.id] = value;
    matched.push({ item, id: pick.id });
  }

  const missing = nationVehicles.filter((v) => !(v.id in values)).map((v) => v.id);
  return { values, unmatched, missing, matched, issues };
}

export interface RunSeedOptions {
  rawDir: string;
  catalogFile: string;
  valuesFile: string;
  reportFile: string;
  /** Необязательно: папка с итогами независимой сверки (verify-*.json); попадают в раздел «Как проверяли». */
  verifyDir?: string;
}

async function writeAtomic(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, file);
}

/** Читает все raw-файлы, сопоставляет, пишет values.json и отчёт. Падает на битом raw, не трогая выходные файлы. */
export async function runSeed(opts: RunSeedOptions): Promise<{ values: ValueMap; reports: NationReport[] }> {
  const catalog = JSON.parse(await readFile(opts.catalogFile, 'utf8')) as TreeCatalog;
  const nationNames = new Map(catalog.nations.map((n) => [n.code, n.nameRu]));
  const files = existsSync(opts.rawDir) ? (await readdir(opts.rawDir)).filter((f) => f.endsWith('.json')).sort() : [];

  const raws = new Map<string, RawNation>();
  for (const file of files) {
    const path = join(opts.rawDir, file);
    let parsed: RawNation;
    try {
      parsed = JSON.parse(await readFile(path, 'utf8')) as RawNation;
    } catch (e) {
      throw new Error(`Не прочитать ${path}: ${(e as Error).message}`);
    }
    const code = file.slice(0, -'.json'.length);
    if (parsed.nation !== code) throw new Error(`${path}: поле nation «${String(parsed.nation)}» не совпадает с именем файла`);
    if (!nationNames.has(parsed.nation as NationCode)) throw new Error(`${path}: нации «${parsed.nation}» нет в каталоге`);
    if (!Array.isArray(parsed.items)) throw new Error(`${path}: нет массива items`);
    raws.set(parsed.nation, parsed);
  }

  const values: ValueMap = {};
  const reports: NationReport[] = [];
  for (const n of catalog.nations) {
    const raw = raws.get(n.code);
    if (!raw) {
      const ids = Object.values(catalog.vehicles).filter((v) => v.nation === n.code).map((v) => v.id);
      reports.push({ code: n.code, nameRu: n.nameRu, raw: null, result: null, missingIds: ids });
      continue;
    }
    const result = matchSeed(raw, catalog);
    Object.assign(values, result.values);
    reports.push({ code: n.code, nameRu: n.nameRu, raw, result, missingIds: result.missing });
  }

  const verifies: VerifyReport[] = [];
  if (opts.verifyDir && existsSync(opts.verifyDir)) {
    for (const file of (await readdir(opts.verifyDir)).filter((f) => f.endsWith('.json')).sort()) {
      const path = join(opts.verifyDir, file);
      try {
        const v = JSON.parse(await readFile(path, 'utf8')) as Omit<VerifyReport, 'name'>;
        if (!v.checked || !Array.isArray(v.mismatches)) throw new Error('нужны поля checked и mismatches');
        verifies.push({ ...v, name: file.slice(0, -'.json'.length) });
      } catch (e) {
        throw new Error(`Не прочитать ${path}: ${(e as Error).message}`);
      }
    }
  }

  await writeAtomic(opts.valuesFile, JSON.stringify(values, null, 2) + '\n');
  await writeAtomic(opts.reportFile, buildReport(reports, catalog, verifies));
  return { values, reports };
}

async function main(): Promise<void> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const { values, reports } = await runSeed({
    rawDir: join(root, 'data/seed/raw'),
    catalogFile: join(root, 'public/catalog/trees.json'),
    valuesFile: join(root, 'data/seed/values.json'),
    reportFile: join(root, 'docs/seed-report.md'),
    verifyDir: join(root, 'data/seed/verify'),
  });
  let unmatched = 0;
  let missing = 0;
  for (const r of reports) {
    unmatched += r.result?.unmatched.length ?? 0;
    missing += r.missingIds.length;
    const cards = r.raw?.items.length ?? 0;
    console.log(`${r.code}: карточек ${cards}, сопоставлено ${r.result?.matched.length ?? 0}, не сопоставлено ${r.result?.unmatched.length ?? 0}, без значения ${r.missingIds.length}`);
  }
  console.log(`values.json: ${Object.keys(values).length} машин; не сопоставлено ${unmatched}, без значения ${missing}. Отчёт: docs/seed-report.md`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
