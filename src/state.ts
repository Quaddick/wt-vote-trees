/**
 * Состояние страницы на сигналах Preact. Компоненты читают сигналы и зовут действия отсюда;
 * в сеть ходит только `./api`.
 *
 * Точка подключения режима правки (таск 04, `src/editor/`): `installEditor(hooks)` +
 * сигналы `editMode`, `editingEnabled`, `selection`, `pending`; `acceptState()` — принять
 * ответ `sendEdit`/`sendUndo`; `refresh()` — опросить сервер сейчас.
 */
import { batch, computed, signal } from '@preact/signals';
import type { ComponentType } from 'preact';
import type {
  Cell,
  Change,
  NationCode,
  NationTree,
  StateResponse,
  TreeCatalog,
  Value,
  ValueMap,
  VehicleInfo,
} from '../shared/types';
import { RECENT_MS, formatValue, normalizeName, sameValue, valueOf } from '../shared/values';
import * as api from './api';

export type ViewMode = 'tree' | 'list';

export interface Connection {
  online: boolean;
  /** Время последнего удачного опроса (мс), null — ещё не было. */
  lastSuccess: number | null;
  /** Неудачных опросов подряд. */
  failures: number;
}

/** Подключаемый режим правки. Всё необязательное: без него страница — только просмотр. */
export interface EditorHooks {
  /** Клик по карточке/строке списка, когда `editMode` включён (вместо окна подробностей). */
  onCardClick?: (id: string, event: MouseEvent) => void;
  /** Панель правки: рисуется всегда, сама решает, когда быть видимой. */
  Panel?: ComponentType;
  /** Кнопки в шапке («Вход», «Выйти»). */
  Toolbar?: ComponentType;
  /** Действия у строки «Последних изменений» («Отменить»). */
  ChangeActions?: ComponentType<{ change: Change }>;
}

export const POLL_MS = 10_000;
/** Паузы после 1-й, 2-й, 3-й и дальнейших ошибок подряд. */
export const RETRY_MS = [10_000, 20_000, 40_000, 60_000] as const;
export const NARROW_QUERY = '(max-width: 767px)';
const FLASH_MS = 2500;

// ── данные ──────────────────────────────────────────────────────────────
export const catalog = signal<TreeCatalog | null>(null);
export const catalogError = signal<string | null>(null);
export const values = signal<ValueMap>({});
export const changes = signal<Change[]>([]);
export const version = signal(0);
export const connection = signal<Connection>({ online: true, lastSuccess: null, failures: 0 });
/** «Сейчас» для подсветки недавних правок; обновляется при каждом опросе. */
export const now = signal(Date.now());

// ── вид ─────────────────────────────────────────────────────────────────
export const nation = signal<NationCode>('us');
/** Фильтр легенды: строка `formatValue` («1», «0.5», «✕») или null. */
export const valueFilter = signal<string | null>(null);
export const view = signal<ViewMode>('tree');
/** ID машины в окне подробностей. */
export const details = signal<string | null>(null);
/** Машина, к которой только что перешли (вспышка + прокрутка). `seq` различает повторные переходы. */
export const flash = signal<{ id: string; seq: number } | null>(null);
/** Выезжающая панель «Последние изменения» на узком экране. */
export const changesOpen = signal(false);

// ── режим правки (заполняет таск 04) ───────────────────────────────────
export const editMode = signal(false);
/** Сервер разрешает вход (пароль задан). */
export const editingEnabled = signal(false);
export const selection = signal<ReadonlySet<string>>(new Set());
/** Машины, чьё значение сейчас сохраняется: ID → новое значение («сохраняю…» на карточке). */
export const pending = signal<ReadonlyMap<string, Value>>(new Map());
export const editor = signal<EditorHooks | null>(null);

export function installEditor(hooks: EditorHooks): void {
  editor.value = hooks;
}

// ── производное ─────────────────────────────────────────────────────────
export const currentTree = computed<NationTree | null>(
  () => catalog.value?.nations.find((n) => n.code === nation.value) ?? null,
);

function cellIds(cell: Cell): string[] {
  if (!cell) return [];
  return cell.t === 'v' ? [cell.id] : cell.items;
}

/** Машины нации по рангам: ранг → исследуемые (по строкам), затем премиум/отряд. */
export function nationRanks(tree: NationTree): { rank: number; research: string[]; premium: string[] }[] {
  return tree.ranks.map((r) => ({
    rank: r.rank,
    research: r.research.flat().flatMap(cellIds),
    premium: r.premium.flat().flatMap(cellIds),
  }));
}

export const nationVehicleIds = computed<string[]>(() => {
  const tree = currentTree.value;
  return tree ? nationRanks(tree).flatMap((r) => [...r.research, ...r.premium]) : [];
});

export interface ValueChip {
  key: string;
  value: Value;
  count: number;
}

/** Чипы легенды: все значения нации с числом машин; коэффициенты по убыванию, блок последним. */
export const valueChips = computed<ValueChip[]>(() => {
  const map = new Map<string, ValueChip>();
  for (const id of nationVehicleIds.value) {
    const v = valueOf(values.value, id);
    const key = formatValue(v);
    const chip = map.get(key);
    if (chip) chip.count++;
    else map.set(key, { key, value: v, count: 1 });
  }
  const rank = (v: Value) => ('b' in v ? -1 : v.c);
  return [...map.values()].sort((a, b) => rank(b.value) - rank(a.value));
});

/** Изменённые за `RECENT_MS`: ID → значение до первой из недавних правок (если оно не совпадает с текущим). */
export const recent = computed<ReadonlyMap<string, Value>>(() => {
  const cutoff = now.value - RECENT_MS;
  const was = new Map<string, Value>();
  // changes — новые первыми; более старая правка перезаписывает «было».
  for (const ch of changes.value) {
    if (Date.parse(ch.at) < cutoff) continue;
    for (const it of ch.items) was.set(it.id, it.from);
  }
  for (const [id, from] of was) if (sameValue(from, valueOf(values.value, id))) was.delete(id);
  return was;
});

/** Последняя правка машины из загруженной истории. */
export function lastChangeOf(id: string): { change: Change; from: Value; to: Value } | null {
  for (const change of changes.value) {
    const item = change.items.find((it) => it.id === id);
    if (item) return { change, from: item.from, to: item.to };
  }
  return null;
}

const searchIndex = computed(() =>
  Object.values(catalog.value?.vehicles ?? {}).map((v) => ({
    v,
    keys: [normalizeName(v.nameRu), normalizeName(v.nameEn)],
  })),
);

/** Поиск по `nameRu`/`nameEn` всех наций; сначала совпадения с начала имени. */
export function searchVehicles(query: string, limit = 30): VehicleInfo[] {
  const q = normalizeName(query);
  if (!q) return [];
  const order = new Map((catalog.value?.nations ?? []).map((n, i) => [n.code, i]));
  const hits: { v: VehicleInfo; score: number }[] = [];
  for (const { v, keys } of searchIndex.value) {
    if (keys.some((k) => k.startsWith(q))) hits.push({ v, score: 0 });
    else if (keys.some((k) => k.includes(q))) hits.push({ v, score: 1 });
  }
  hits.sort(
    (a, b) =>
      a.score - b.score ||
      (order.get(a.v.nation) ?? 0) - (order.get(b.v.nation) ?? 0) ||
      a.v.rank - b.v.rank ||
      a.v.name.localeCompare(b.v.name),
  );
  return hits.slice(0, limit).map((h) => h.v);
}

// ── действия ────────────────────────────────────────────────────────────
function writeHash(hash: string): void {
  if (typeof history !== 'undefined' && location.hash !== `#${hash}`) history.replaceState(null, '', `#${hash}`);
}

export function selectNation(code: NationCode, opts: { writeHash?: boolean } = {}): void {
  batch(() => {
    if (nation.value !== code) valueFilter.value = null;
    nation.value = code;
  });
  if (opts.writeHash !== false) writeHash(code);
}

let flashSeq = 0;
let flashTimer: ReturnType<typeof setTimeout> | undefined;

/** Открыть нацию машины, прокрутить к ней и подсветить. */
export function openVehicle(id: string, opts: { writeHash?: boolean } = {}): void {
  const v = catalog.value?.vehicles[id];
  if (!v) return;
  const seq = ++flashSeq;
  batch(() => {
    selectNation(v.nation, { writeHash: false });
    flash.value = { id, seq };
  });
  if (opts.writeHash !== false) writeHash(`${v.nation}/${id}`);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    if (flash.value?.seq === seq) flash.value = null;
  }, FLASH_MS);
}

export function toggleFilter(key: string): void {
  valueFilter.value = valueFilter.value === key ? null : key;
}

export function setView(mode: ViewMode): void {
  view.value = mode;
}

export function showDetails(id: string): void {
  details.value = id;
}

export function closeDetails(): void {
  details.value = null;
}

/** Клик по карточке: в режиме правки — обработчик редактора, иначе подробности. */
export function cardClick(id: string, event: MouseEvent): void {
  const hooks = editor.value;
  if (editMode.value && hooks?.onCardClick) hooks.onCardClick(id, event);
  else showDetails(id);
}

/** Принять полное состояние с сервера (ответ опроса, `sendEdit`, `sendUndo`). */
export function acceptState(state: StateResponse): void {
  etag = `"${state.version}"`;
  batch(() => {
    values.value = state.values;
    changes.value = state.changes;
    version.value = state.version;
    now.value = Date.now();
  });
}

// ── опрос и запуск ──────────────────────────────────────────────────────
let etag: string | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;

async function poll(gen: number): Promise<void> {
  clearTimeout(timer);
  try {
    const res = await api.fetchState(etag);
    if (gen !== generation) return;
    if (res !== 'not-modified') {
      acceptState(res.state);
      etag = res.etag;
    }
    connection.value = { online: true, lastSuccess: Date.now(), failures: 0 };
  } catch {
    if (gen !== generation) return;
    const c = connection.value;
    connection.value = { ...c, online: false, failures: c.failures + 1 };
  }
  now.value = Date.now();
  const c = connection.value;
  const delay = c.online ? POLL_MS : RETRY_MS[Math.min(c.failures, RETRY_MS.length) - 1];
  timer = setTimeout(() => void poll(gen), delay);
}

/** Опросить сервер сейчас (например, после входа). */
export function refresh(): Promise<void> {
  return poll(generation);
}

const NATION_CODES = new Set<string>(['us', 'germ', 'ussr', 'uk', 'jp', 'cn', 'it', 'fr', 'sw', 'il']);

function applyHash(): void {
  const raw = decodeURIComponent(location.hash.replace(/^#/, ''));
  const [code, id] = raw.split('/');
  if (id && catalog.value?.vehicles[id]) openVehicle(id, { writeHash: false });
  else if (code && NATION_CODES.has(code) && catalog.value?.nations.some((n) => n.code === code))
    selectNation(code as NationCode, { writeHash: false });
}

/**
 * Запуск страницы: сбрасывает состояние, грузит каталог, разбирает `#nation/id`,
 * спрашивает `/api/me` и начинает опрос. Возвращает остановку.
 */
export function start(): () => void {
  const gen = ++generation;
  clearTimeout(timer);
  clearTimeout(flashTimer);
  etag = undefined;
  const narrow = typeof matchMedia === 'function' && matchMedia(NARROW_QUERY).matches;
  batch(() => {
    catalog.value = null;
    catalogError.value = null;
    values.value = {};
    changes.value = [];
    version.value = 0;
    connection.value = { online: true, lastSuccess: null, failures: 0 };
    now.value = Date.now();
    nation.value = 'us';
    valueFilter.value = null;
    view.value = narrow ? 'list' : 'tree';
    details.value = null;
    flash.value = null;
    changesOpen.value = false;
    editMode.value = false;
    editingEnabled.value = false;
    selection.value = new Set();
    pending.value = new Map();
  });

  const onHash = () => applyHash();
  window.addEventListener('hashchange', onHash);

  api.loadCatalog().then(
    (cat) => {
      if (gen !== generation) return;
      batch(() => {
        catalog.value = cat;
        if (!cat.nations.some((n) => n.code === nation.value) && cat.nations[0]) nation.value = cat.nations[0].code;
      });
      applyHash();
    },
    () => {
      if (gen === generation) catalogError.value = 'Не удалось загрузить деревья техники. Обнови страницу.';
    },
  );
  api.fetchMe().then(
    (me) => {
      if (gen !== generation) return;
      batch(() => {
        editingEnabled.value = me.editingEnabled;
        editMode.value = me.editor;
      });
    },
    () => {},
  );
  void poll(gen);

  return () => {
    if (gen === generation) generation++;
    clearTimeout(timer);
    clearTimeout(flashTimer);
    window.removeEventListener('hashchange', onHash);
  };
}
