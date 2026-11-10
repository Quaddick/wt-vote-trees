/**
 * Дерево нации как на вики: слева исследуемая техника по колонкам, справа премиум/отряд;
 * ранги — полосы с подписью; линии-стрелки от машины к той, что от неё исследуется (`req`).
 * Ячейка ставится в CSS-сетку по строке и колонке каталога; линии рисуются поверх по замерам DOM.
 */
import { Fragment } from 'preact';
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Cell, NationTree, TreeCatalog } from '../../shared/types';
import { catalog, currentTree } from '../state';
import { roman } from '../format';
import { VehicleCard } from './VehicleCard';

type FilledCell = Exclude<Cell, null>;

interface Placement {
  key: string;
  cell: FilledCell;
  row: number;
  col: number;
}

interface Layout {
  columns: string;
  separatorCol: number;
  premiumStart: number;
  lastRow: number;
  bands: { rank: number; row: number }[];
  cells: Placement[];
  edges: { from: string; to: string }[];
}

/** Ключ ячейки в DOM: ID папки-«связки» совпадает с ID её первой машины, поэтому с префиксом типа. */
export function cellKey(cell: FilledCell): string {
  return `${cell.t}:${cell.id}`;
}

function layoutTree(tree: NationTree, cat: TreeCatalog): Layout {
  const R = tree.researchColumns;
  const P = tree.premiumColumns;
  const separatorCol = R + 1;
  const premiumStart = R + 2;
  const cells: Placement[] = [];
  const bands: Layout['bands'] = [];
  let row = 2; // строка 1 — заголовки блоков
  for (const rank of tree.ranks) {
    bands.push({ rank: rank.rank, row });
    row++;
    const rows = Math.max(rank.research.length, rank.premium.length);
    for (let r = 0; r < rows; r++) {
      rank.research[r]?.forEach((cell, c) => {
        if (cell) cells.push({ key: cellKey(cell), cell, row: row + r, col: c + 1 });
      });
      rank.premium[r]?.forEach((cell, c) => {
        if (cell) cells.push({ key: cellKey(cell), cell, row: row + r, col: premiumStart + c });
      });
    }
    row += rows;
  }

  // Источник линии: машина или папка с этим ID, иначе папка, в которой лежит машина.
  const byId = new Map<string, string>();
  for (const p of cells) if (p.cell.t === 'v') byId.set(p.cell.id, p.key);
  for (const p of cells) if (p.cell.t === 'g' && !byId.has(p.cell.id)) byId.set(p.cell.id, p.key);
  for (const p of cells)
    if (p.cell.t === 'g') for (const item of p.cell.items) if (!byId.has(item)) byId.set(item, p.key);

  const edges: Layout['edges'] = [];
  for (const p of cells) {
    const req = p.cell.t === 'g' ? p.cell.req : (cat.vehicles[p.cell.id]?.req ?? null);
    const from = req ? byId.get(req) : undefined;
    if (from && from !== p.key) edges.push({ from, to: p.key });
  }

  return {
    columns: `repeat(${R}, var(--cell-w)) var(--sep-w) repeat(${P}, var(--cell-w))`,
    separatorCol,
    premiumStart,
    lastRow: row - 1,
    bands,
    cells,
    edges,
  };
}

interface Line {
  key: string;
  d: string;
}

const ARROW_GAP = 3;

function measureLines(root: HTMLElement, edges: Layout['edges']): Line[] {
  const base = root.getBoundingClientRect();
  const rects = new Map<string, DOMRect>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-cell]')) rects.set(el.dataset.cell ?? '', el.getBoundingClientRect());
  const rectOf = (key: string) => rects.get(key);
  const lines: Line[] = [];
  for (const e of edges) {
    const a = rectOf(e.from);
    const b = rectOf(e.to);
    if (!a || !b) continue;
    const x1 = a.left + a.width / 2 - base.left;
    const y1 = a.bottom - base.top;
    const x2 = b.left + b.width / 2 - base.left;
    const y2 = b.top - base.top - ARROW_GAP;
    const d =
      Math.abs(x1 - x2) < 1
        ? `M${x1} ${y1}V${y2}`
        : `M${x1} ${y1}V${Math.max(y1, y2 - 12)}H${x2}V${y2}`;
    lines.push({ key: `${e.from}>${e.to}`, d });
  }
  return lines;
}

function GroupCell({ cell }: { cell: Extract<FilledCell, { t: 'g' }> }) {
  const vehicles = catalog.value?.vehicles ?? {};
  return (
    <div class="group" title={cell.nameRu}>
      {cell.items.map((id, i) => (
        <Fragment key={id}>
          {i > 0 && vehicles[id]?.req === cell.items[i - 1] && <span class="group-arrow" aria-hidden="true" />}
          {i > 0 && vehicles[id]?.req !== cell.items[i - 1] && <span class="group-gap" aria-hidden="true" />}
          <VehicleCard id={id} />
        </Fragment>
      ))}
    </div>
  );
}

export function TreeView() {
  const tree = currentTree.value;
  const cat = catalog.value;
  const layout = useMemo(() => (tree && cat ? layoutTree(tree, cat) : null), [tree, cat]);
  const rootRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<Line[]>([]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !layout) return;
    const update = () => setLines(measureLines(root, layout.edges));
    update();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    ro?.observe(root);
    window.addEventListener('resize', update);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [layout]);

  if (!tree || !layout) return null;
  const { separatorCol, premiumStart, lastRow } = layout;
  return (
    <div class="tree-scroll">
      <div class="tree" ref={rootRef} style={{ gridTemplateColumns: layout.columns }} data-nation={tree.code}>
        <svg class="tree-lines" aria-hidden="true">
          <defs>
            <marker id="tree-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3" markerHeight="3" orient="auto">
              <path d="M0 0L10 5L0 10z" />
            </marker>
          </defs>
          {layout.edges.map((e) => {
            const key = `${e.from}>${e.to}`;
            const line = lines.find((l) => l.key === key);
            return <path key={key} data-edge={key} d={line?.d ?? ''} marker-end="url(#tree-arrow)" />;
          })}
        </svg>
        <div class="tree-head" style={{ gridColumn: `1 / ${separatorCol}`, gridRow: 1 }}>
          <span>Исследуемая техника</span>
        </div>
        <div class="tree-head tree-head--premium" style={{ gridColumn: `${premiumStart} / -1`, gridRow: 1 }}>
          <span>Премиумная техника</span>
        </div>
        <div class="tree-separator" style={{ gridColumn: separatorCol, gridRow: `1 / ${lastRow + 1}` }} />
        {layout.bands.map((b) => (
          <div key={`rank-${b.rank}`} class="rank-band" data-rank-band={b.rank} style={{ gridColumn: '1 / -1', gridRow: b.row }}>
            <span>Ранг {roman(b.rank)}</span>
          </div>
        ))}
        {layout.cells.map((p) => (
          <div
            key={p.key}
            class="tree-cell"
            data-cell={p.key}
            style={{ gridColumnStart: p.col, gridRowStart: p.row }}
          >
            {p.cell.t === 'v' ? <VehicleCard id={p.cell.id} /> : <GroupCell cell={p.cell} />}
          </div>
        ))}
      </div>
    </div>
  );
}
