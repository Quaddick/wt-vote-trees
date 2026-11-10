/**
 * Значения машин: коэффициент или блок. Чистые функции, общие для сервера, страницы и скриптов.
 */
import type { Change, Edit, Value, ValueMap } from './types';

export const DEFAULT_VALUE: Value = Object.freeze({ c: 1 }) as Value;

export const PRESETS: Value[] = [{ c: 1 }, { c: 0.8 }, { c: 0.5 }, { c: 0.4 }, { c: 0.3 }, { c: 0.2 }, { b: true }];

/** Сколько правка считается «недавней» (подсветка, бейдж «было …»). */
export const RECENT_MS = 3 * 60 * 60 * 1000;

const MIN_C = 0.01;
const MAX_C = 10;
const RANGE_ERROR = 'Коэффициент — число от 0.01 до 10';
const DECIMALS_ERROR = 'Коэффициент — не больше двух знаков после точки';

/** Округление до сотых без хвоста двоичной арифметики (0.1 + 0.2 → 0.3). */
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function hasTwoDecimals(x: number): boolean {
  return Math.abs(x * 100 - Math.round(x * 100)) < 1e-6;
}

function isBlock(v: Value): v is { b: true } {
  return 'b' in v;
}

export function valueOf(values: ValueMap, id: string): Value {
  return Object.hasOwn(values, id) ? values[id] : DEFAULT_VALUE;
}

export function sameValue(a: Value, b: Value): boolean {
  if (isBlock(a) || isBlock(b)) return isBlock(a) && isBlock(b);
  return round2(a.c) === round2(b.c);
}

/** «1», «0.8», «0.25», «✕» — без хвостовых нулей. */
export function formatValue(v: Value): string {
  return isBlock(v) ? '✕' : String(round2(v.c));
}

/** Ввод поля «свой»: запятая = точка; ошибка — по-русски. */
export function parseCoefficient(input: string): { ok: true; value: Value } | { ok: false; error: string } {
  const s = input.trim().replace(',', '.');
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return { ok: false, error: RANGE_ERROR };
  const c = Number(s);
  if (!Number.isFinite(c) || c < MIN_C || c > MAX_C) return { ok: false, error: RANGE_ERROR };
  if (!hasTwoDecimals(c)) return { ok: false, error: DECIMALS_ERROR };
  return { ok: true, value: { c: round2(c) } };
}

export function isValidValue(x: unknown): x is Value {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const keys = Object.keys(x);
  if (keys.length !== 1) return false;
  const o = x as Record<string, unknown>;
  if (keys[0] === 'b') return o.b === true;
  if (keys[0] !== 'c') return false;
  const c = o.c;
  return typeof c === 'number' && Number.isFinite(c) && c >= MIN_C && c <= MAX_C && hasTwoDecimals(c);
}

/** Применяет правку, не трогая вход. В items — только машины, у которых значение правда изменилось. */
export function applyEdit(values: ValueMap, edit: Edit): { values: ValueMap; items: Change['items'] } {
  if (!isValidValue(edit.to)) throw new Error(`Неверное значение: ${JSON.stringify(edit.to)}`);
  const to = edit.to;
  const next: ValueMap = { ...values };
  const items: Change['items'] = [];
  for (const id of new Set(edit.ids)) {
    const from = valueOf(next, id);
    if (sameValue(from, to)) continue;
    items.push({ id, from: { ...from }, to: { ...to } });
    next[id] = { ...to };
  }
  return { values: next, items };
}

/** `seq` записей истории, которые уже отменены (на них ссылается запись `undo`). */
export function undoneSeqs(changes: readonly Change[]): Set<number> {
  const out = new Set<number>();
  for (const c of changes) if (c.kind === 'undo' && c.undoOf !== undefined) out.add(c.undoOf);
  return out;
}

/**
 * Что вернёт отмена записи: только машины, у которых сейчас всё ещё «стало» этой записи.
 * Машину, которую после неё меняли ещё раз, отмена не трогает — иначе затрёт более позднюю правку.
 */
export function undoableItems(change: Change, values: ValueMap): Change['items'] {
  return change.items.filter((it) => sameValue(valueOf(values, it.id), it.to));
}

// Дефисы и тире, точки, кавычки всех видов, пробелы (в т.ч. неразрывные).
const NAME_NOISE = /[\s\-‐‑‒–—―.'"`«»„“”‘’‚]/g;

/** Ключ для сравнения имён: регистр, ё→е, без пробелов/дефисов/точек/кавычек, «№» → «no». */
export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/№/g, 'no').replace(NAME_NOISE, '');
}

/**
 * Правило G01: имя русской вики, если его первая буква кириллическая (советская техника в любом дереве),
 * иначе английское имя. Цифры перед первой буквой не считаются («2С19-М2» — кириллица).
 */
export function displayName(nameRu: string, nameEn: string): string {
  const first = nameRu.match(/\p{L}/u)?.[0];
  return first !== undefined && /\p{Script=Cyrillic}/u.test(first) ? nameRu : nameEn;
}
