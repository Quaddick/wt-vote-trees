/**
 * Разбор страницы дерева наземки вики (`/ground`, en или ru) в раскладку: ранги × строки × колонки.
 *
 * Разметка (2026-11): `.unit-tree[data-tree-id]` на нацию → `.wt-tree_instance`, в нём попеременно
 * `.wt-tree_r-header` («Rank <span>IV</span>») и `.wt-tree_rank`. В строке ранга два блока
 * `div[style*=grid-column]` (исследуемый и премиумный; `.wt-tree_v-line` между ними — разделитель),
 * в каждом `table.wt-tree_rank-instance` → `tr` → `td`. Пустой `td` — пустая ячейка, колонки выровнены.
 * В ячейке машина `.wt-tree_item[data-unit-id]` или папка `.wt-tree_group[data-unit-id]` с машинами
 * в `.wt-tree_group-items`. Связь исследования — `data-unit-req` (ID машины или группы).
 */
import { parse, type HTMLElement } from 'node-html-parser';
import type { NationCode, VehicleClass } from '../../shared/types';
import { nationFromTree } from './nations';

export type ParsedCell =
  | null
  | { t: 'v'; id: string }
  | { t: 'g'; id: string; name: string; items: string[]; req: string | null };

export interface ParsedVehicle {
  id: string;
  /** Имя с этой страницы (en или ru), очищенное от глифов */
  name: string;
  cls: VehicleClass;
  rank: number;
  req: string | null;
}

export interface ParsedRank {
  rank: number;
  research: ParsedCell[][];
  premium: ParsedCell[][];
}

export interface ParsedNation {
  code: NationCode;
  /** `data-tree-id` */
  tree: string;
  researchColumns: number;
  premiumColumns: number;
  /** По возрастанию ранга */
  ranks: ParsedRank[];
  /** В порядке дерева: ранг, строка, колонка */
  vehicles: ParsedVehicle[];
}

// Глифы игрового шрифта: U+2400–U+25FF (␗ ▃ ○ ◊ …) и Private Use Area U+E000–U+F8FF. «№» (U+2116) сохраняется.
const GAME_GLYPHS = /[␀-◿-]/g;

/** Убирает из названия глифы игрового шрифта, PUA-символы и лишние/неразрывные пробелы. */
export function cleanName(raw: string): string {
  return raw.replace(GAME_GLYPHS, '').replace(/\s+/g, ' ').trim();
}

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };

const elementChildren = (el: HTMLElement): HTMLElement[] =>
  el.childNodes.filter((n): n is HTMLElement => n.nodeType === 1);

const attr = (el: HTMLElement, name: string): string | null => el.getAttribute(name)?.trim() || null;

const textOf = (el: HTMLElement | null): string => cleanName(el?.querySelector('.wt-tree_item-text span')?.text ?? '');

function vehicleClass(el: HTMLElement, inPremiumBlock: boolean): VehicleClass {
  if (el.classList.contains('wt-tree_item--squad')) return 'squad';
  // В премиумном блоке стоят и подарочные/событийные машины без `--prem`: исследовать их нельзя.
  if (el.classList.contains('wt-tree_item--prem') || inPremiumBlock) return 'premium';
  return 'research';
}

interface BlockResult {
  rows: ParsedCell[][];
  columns: number;
}

function parseBlock(
  block: HTMLElement | undefined,
  rank: number,
  inPremiumBlock: boolean,
  out: ParsedVehicle[],
): BlockResult {
  const table = block?.querySelector('table.wt-tree_rank-instance');
  if (!table) return { rows: [], columns: 0 };
  const rows: ParsedCell[][] = [];
  let columns = 0;
  for (const tr of table.querySelectorAll('tr')) {
    const row: ParsedCell[] = [];
    for (const td of elementChildren(tr).filter((c) => c.tagName === 'TD')) {
      row.push(parseCell(td, rank, inPremiumBlock, out));
    }
    columns = Math.max(columns, row.length);
    rows.push(row);
  }
  return { rows, columns };
}

function pushVehicle(
  el: HTMLElement,
  rank: number,
  inPremiumBlock: boolean,
  fallbackReq: string | null,
  out: ParsedVehicle[],
): string | null {
  const id = attr(el, 'data-unit-id');
  if (!id) return null;
  out.push({
    id,
    name: textOf(el),
    cls: vehicleClass(el, inPremiumBlock),
    rank,
    req: attr(el, 'data-unit-req') ?? fallbackReq,
  });
  return id;
}

function parseCell(td: HTMLElement, rank: number, inPremiumBlock: boolean, out: ParsedVehicle[]): ParsedCell {
  const el = elementChildren(td).find(
    (c) => c.classList.contains('wt-tree_group') || c.classList.contains('wt-tree_item'),
  );
  if (!el) return null;
  if (el.classList.contains('wt-tree_group')) {
    const id = attr(el, 'data-unit-id');
    if (!id) return null;
    const req = attr(el, 'data-unit-req');
    const itemsBox = el.querySelector('.wt-tree_group-items');
    const items: string[] = [];
    for (const item of itemsBox ? elementChildren(itemsBox) : []) {
      if (!item.classList.contains('wt-tree_item')) continue;
      // Первая машина папки своего req не несёт — она исследуется от того же, что и папка.
      const got = pushVehicle(item, rank, inPremiumBlock, req, out);
      if (got) items.push(got);
    }
    return { t: 'g', id, name: textOf(el.querySelector('.wt-tree_group-folder')), items, req };
  }
  const id = pushVehicle(el, rank, inPremiumBlock, null, out);
  return id ? { t: 'v', id } : null;
}

const pad = (rows: ParsedCell[][], columns: number): ParsedCell[][] =>
  rows.map((row) => [...row, ...Array<ParsedCell>(Math.max(0, columns - row.length)).fill(null)]);

function parseNation(treeEl: HTMLElement, code: NationCode, tree: string): ParsedNation {
  const vehicles: ParsedVehicle[] = [];
  const ranks: ParsedRank[] = [];
  let researchColumns = 0;
  let premiumColumns = 0;
  let currentRank: number | null = null;
  const instance = treeEl.querySelector('.wt-tree_instance');
  for (const child of instance ? elementChildren(instance) : []) {
    if (child.classList.contains('wt-tree_r-header')) {
      const label = child
        .querySelectorAll('.wt-tree_r-header_label span')
        .map((s) => s.text.trim())
        .find((s) => s in ROMAN);
      currentRank = label ? ROMAN[label] : null;
      continue;
    }
    if (!child.classList.contains('wt-tree_rank') || currentRank === null) continue;
    const blocks = elementChildren(child).filter(
      (c) => !c.classList.contains('wt-tree_v-line') && (c.getAttribute('style') ?? '').includes('grid-column'),
    );
    const research = parseBlock(blocks[0], currentRank, false, vehicles);
    const premium = parseBlock(blocks[1], currentRank, true, vehicles);
    researchColumns = Math.max(researchColumns, research.columns);
    premiumColumns = Math.max(premiumColumns, premium.columns);
    ranks.push({ rank: currentRank, research: research.rows, premium: premium.rows });
  }
  ranks.sort((a, b) => a.rank - b.rank);
  for (const r of ranks) {
    r.research = pad(r.research, researchColumns);
    r.premium = pad(r.premium, premiumColumns);
  }
  // Порядок машин — как в дереве после сортировки рангов.
  const order = new Map(ranks.map((r, i) => [r.rank, i]));
  const seen = new Set<string>();
  const unique = vehicles
    .map((v, i) => ({ v, i }))
    .sort((a, b) => (order.get(a.v.rank) ?? 0) - (order.get(b.v.rank) ?? 0) || a.i - b.i)
    .map(({ v }) => v)
    .filter((v) => (seen.has(v.id) ? false : (seen.add(v.id), true)));
  return { code, tree, researchColumns, premiumColumns, ranks, vehicles: unique };
}

/** Разбирает страницу дерева наземки. Неизвестные деревья пропускаются; нет деревьев — пустой список. */
export function parseTreeLayout(html: string): ParsedNation[] {
  const root = parse(html);
  const out: ParsedNation[] = [];
  for (const treeEl of root.querySelectorAll('.unit-tree[data-tree-id]')) {
    const tree = attr(treeEl, 'data-tree-id') ?? undefined;
    const meta = nationFromTree(tree);
    if (!meta || out.some((n) => n.code === meta.code)) continue;
    out.push(parseNation(treeEl, meta.code, meta.tree));
  }
  return out;
}
