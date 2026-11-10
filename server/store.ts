/**
 * Хранилище значений и истории правок: два JSON-файла в папке данных.
 * Запись атомарная (tmp + rename). Битый файл при открытии — ошибка с путём, файл не трогается.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Change, Edit, StateResponse, Value, ValueMap } from '../shared/types';
import { applyEdit, isValidValue, sameValue, undoableItems, undoneSeqs, valueOf } from '../shared/values';

export interface Store {
  state(limit?: number): StateResponse;
  apply(edits: Edit[], kind: 'edit' | 'import'): Change | null;
  undo(seq: number): Change | null;
}

/** Записи истории с таким `seq` нет (или она уже вытеснена обрезкой). */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

const DEFAULT_HISTORY_CAP = 1000;
const DEFAULT_STATE_LIMIT = 100;

export function openStore(opts: { dataDir: string; seedFile: string; historyCap?: number }): Store {
  const historyCap = opts.historyCap ?? DEFAULT_HISTORY_CAP;
  const valuesFile = join(opts.dataDir, 'values.json');
  const changesFile = join(opts.dataDir, 'changes.json');

  mkdirSync(opts.dataDir, { recursive: true });

  let values: ValueMap;
  if (existsSync(valuesFile)) {
    values = readValueMap(valuesFile);
  } else {
    values = loadSeed(opts.seedFile);
    writeJsonAtomic(valuesFile, values);
  }
  let changes: Change[] = existsSync(changesFile) ? readChanges(changesFile) : [];
  let version = changes.length > 0 ? changes[changes.length - 1].seq : 0;

  /** Сводит правки к одной записи: для каждой машины «было» — до запроса, «стало» — после. */
  function commit(edits: Edit[], kind: Change['kind'], undoOf?: number): Change | null {
    let next = values;
    const touched = new Set<string>();
    for (const edit of edits) {
      const r = applyEdit(next, edit);
      next = r.values;
      for (const item of r.items) touched.add(item.id);
    }
    const items: Change['items'] = [];
    for (const id of touched) {
      const from = valueOf(values, id);
      const to = valueOf(next, id);
      if (!sameValue(from, to)) items.push({ id, from: { ...from }, to: { ...to } });
    }
    if (items.length === 0) return null;

    const change: Change = { seq: version + 1, at: new Date().toISOString(), kind, items };
    if (undoOf !== undefined) change.undoOf = undoOf;
    const nextChanges = [...changes, change].slice(-historyCap);

    writeJsonAtomic(valuesFile, next);
    writeJsonAtomic(changesFile, nextChanges);
    values = next;
    changes = nextChanges;
    version = change.seq;
    return change;
  }

  return {
    state(limit = DEFAULT_STATE_LIMIT) {
      return {
        version,
        values: structuredClone(values),
        changes: structuredClone(changes.slice(-limit).reverse()),
      };
    },

    apply(edits, kind) {
      return commit(edits, kind);
    },

    undo(seq) {
      const target = changes.find((c) => c.seq === seq);
      if (!target) throw new NotFoundError(`Записи истории №${seq} нет`);
      // Отмену не отменяют, отменённое второй раз не отменяют — иначе журнал растёт «отменами отмен».
      if (target.kind === 'undo' || undoneSeqs(changes).has(seq)) return null;
      return commit(
        undoableItems(target, values).map((item) => ({ ids: [item.id], to: item.from })),
        'undo',
        seq,
      );
    },
  };
}

function loadSeed(seedFile: string): ValueMap {
  if (!existsSync(seedFile)) {
    console.warn(`[store] нет стартовых значений ${seedFile} — у всех машин будет «1»`);
    return {};
  }
  return readValueMap(seedFile);
}

function readJson(file: string): unknown {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    throw new Error(`Не читается файл ${file}: ${(e as Error).message}`);
  }
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch (e) {
    throw new Error(`Битый JSON в файле ${file}: ${(e as Error).message}. Почини или удали его; сервер его не трогал.`);
  }
}

function readValueMap(file: string): ValueMap {
  const data = readJson(file);
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`Файл ${file} — не объект значений машин`);
  }
  const out: ValueMap = {};
  for (const [id, v] of Object.entries(data)) {
    if (!isValidValue(v)) throw new Error(`Файл ${file}: недопустимое значение у «${id}»: ${JSON.stringify(v)}`);
    out[id] = v;
  }
  return out;
}

function isValidChange(x: unknown): x is Change {
  if (typeof x !== 'object' || x === null) return false;
  const c = x as Partial<Change>;
  return (
    Number.isInteger(c.seq) &&
    typeof c.at === 'string' &&
    (c.kind === 'edit' || c.kind === 'undo' || c.kind === 'import') &&
    Array.isArray(c.items) &&
    c.items.every(
      (i: { id?: unknown; from?: unknown; to?: unknown }) =>
        typeof i?.id === 'string' && isValidValue(i.from as Value) && isValidValue(i.to as Value),
    )
  );
}

function readChanges(file: string): Change[] {
  const data = readJson(file);
  if (!Array.isArray(data)) throw new Error(`Файл ${file} — не список записей истории`);
  data.forEach((c, i) => {
    if (!isValidChange(c)) throw new Error(`Файл ${file}: запись №${i + 1} истории испорчена`);
  });
  return data as Change[];
}

function writeJsonAtomic(file: string, data: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 1) + '\n');
  renameSync(tmp, file);
}
