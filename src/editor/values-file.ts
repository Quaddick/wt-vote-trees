/**
 * Файл значений («Скачать значения» / «Загрузить»): формат, чтение и разница с текущими значениями.
 * Чистые функции — без DOM и сети.
 */
import type { Edit, Value, ValueMap } from '../../shared/types';
import { formatValue, isValidValue, sameValue, valueOf } from '../../shared/values';

export const FILE_KIND = 'wt-vote-trees/values';

/** Те же правила ID, что у сервера: иначе файл всё равно не примут. */
const ID_RE = /^[A-Za-z0-9_.-]{1,100}$/;

const pad = (n: number) => String(n).padStart(2, '0');

/** `wt-values-ГГГГ-ММ-ДД.json` по местной дате. */
export function exportFileName(date: Date): string {
  return `wt-values-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

/**
 * Содержимое файла: значение каждой машины каталога (в т.ч. «1» — явно, чтобы загрузка
 * вернула и сброшенные машины) и записи значений, которых в каталоге уже нет.
 */
export function serializeValues(values: ValueMap, catalogIds: Iterable<string>, at: Date): string {
  const ids = new Set<string>(catalogIds);
  for (const id of Object.keys(values)) ids.add(id);
  const out: ValueMap = {};
  for (const id of [...ids].sort()) out[id] = { ...valueOf(values, id) };
  return `${JSON.stringify({ kind: FILE_KIND, version: 1, exportedAt: at.toISOString(), values: out }, null, 1)}\n`;
}

function asValueMap(x: unknown): ValueMap | null {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return null;
  const entries = Object.entries(x);
  if (entries.length === 0) return null;
  const out: ValueMap = {};
  for (const [id, v] of entries) {
    if (!ID_RE.test(id) || id === '__proto__' || !isValidValue(v)) return null;
    out[id] = 'b' in v ? { b: true } : { c: v.c };
  }
  return out;
}

/** Файл, выгруженный сайтом, или голая карта значений. Не похоже на значения → null. */
export function parseValuesFile(text: string): ValueMap | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  if (Object.hasOwn(data, 'values')) return asValueMap((data as { values: unknown }).values);
  return asValueMap(data);
}

/** Правки, которые приведут текущие значения к файлу: одна правка на каждое значение. */
export function importEdits(current: ValueMap, incoming: ValueMap): { edits: Edit[]; count: number } {
  const groups = new Map<string, { to: Value; ids: string[] }>();
  let count = 0;
  for (const [id, to] of Object.entries(incoming)) {
    if (sameValue(valueOf(current, id), to)) continue;
    const key = formatValue(to);
    const group = groups.get(key) ?? { to, ids: [] };
    group.ids.push(id);
    groups.set(key, group);
    count++;
  }
  return { edits: [...groups.values()].map((g) => ({ ids: g.ids, to: g.to })), count };
}
