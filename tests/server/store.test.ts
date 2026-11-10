import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError, openStore } from '../../server/store';

let root: string;
let dataDir: string;
let seedFile: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'wtv-store-'));
  dataDir = join(root, 'runtime');
  seedFile = join(root, 'seed-values.json');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'));
}

describe('первый запуск', () => {
  it('без values.json копирует seed, история пустая, версия 0', () => {
    writeFileSync(seedFile, JSON.stringify({ ussr_is_2: { c: 0.5 }, germ_tiger: { b: true } }));
    const store = openStore({ dataDir, seedFile });
    const s = store.state();
    expect(s).toEqual({ version: 0, values: { ussr_is_2: { c: 0.5 }, germ_tiger: { b: true } }, changes: [] });
    expect(readJson(join(dataDir, 'values.json'))).toEqual({ ussr_is_2: { c: 0.5 }, germ_tiger: { b: true } });
  });

  it('нет и seed — пустые значения и предупреждение, а не падение', () => {
    const store = openStore({ dataDir, seedFile: join(root, 'missing.json') });
    expect(store.state()).toEqual({ version: 0, values: {}, changes: [] });
    expect(console.warn).toHaveBeenCalled();
  });

  it('values.json уже есть — seed не перетирает его', () => {
    writeFileSync(seedFile, JSON.stringify({ a: { c: 0.5 } }));
    const first = openStore({ dataDir, seedFile });
    first.apply([{ ids: ['a'], to: { c: 0.3 } }], 'edit');
    const again = openStore({ dataDir, seedFile });
    expect(again.state().values).toEqual({ a: { c: 0.3 } });
    expect(again.state().version).toBe(1);
  });
});

describe('битые файлы', () => {
  it('битый values.json → ошибка с путём, файл не тронут', () => {
    openStore({ dataDir, seedFile }); // создаёт папку
    const file = join(dataDir, 'values.json');
    writeFileSync(file, '{ not json');
    expect(() => openStore({ dataDir, seedFile })).toThrow(file);
    expect(readFileSync(file, 'utf8')).toBe('{ not json');
  });

  it('values.json с недопустимым значением → ошибка с путём', () => {
    openStore({ dataDir, seedFile });
    const file = join(dataDir, 'values.json');
    writeFileSync(file, JSON.stringify({ a: { c: 'много' } }));
    expect(() => openStore({ dataDir, seedFile })).toThrow(file);
  });

  it('битый changes.json → ошибка с путём, файл не тронут', () => {
    openStore({ dataDir, seedFile });
    const file = join(dataDir, 'changes.json');
    writeFileSync(file, '[{"seq":');
    expect(() => openStore({ dataDir, seedFile })).toThrow(file);
    expect(readFileSync(file, 'utf8')).toBe('[{"seq":');
  });
});

describe('apply', () => {
  it('одна запись на вызов, только реально изменившиеся машины', () => {
    writeFileSync(seedFile, JSON.stringify({ a: { c: 0.5 } }));
    const store = openStore({ dataDir, seedFile });
    const ch = store.apply([{ ids: ['a', 'b', 'c'], to: { c: 0.5 } }], 'edit');
    expect(ch).not.toBeNull();
    expect(ch!.seq).toBe(1);
    expect(ch!.kind).toBe('edit');
    expect(ch!.items).toEqual([
      { id: 'b', from: { c: 1 }, to: { c: 0.5 } },
      { id: 'c', from: { c: 1 }, to: { c: 0.5 } },
    ]);
    expect(Number.isNaN(Date.parse(ch!.at))).toBe(false);
    const s = store.state();
    expect(s.version).toBe(1);
    expect(s.changes).toHaveLength(1);
  });

  it('повтор того же значения не создаёт записи', () => {
    const store = openStore({ dataDir, seedFile });
    store.apply([{ ids: ['a'], to: { b: true } }], 'edit');
    expect(store.apply([{ ids: ['a'], to: { b: true } }], 'edit')).toBeNull();
    expect(store.state().version).toBe(1);
    expect(store.state().changes).toHaveLength(1);
  });

  it('несколько правок в запросе — одна запись; машина, вернувшаяся к исходному, в неё не попадает', () => {
    const store = openStore({ dataDir, seedFile });
    const ch = store.apply(
      [
        { ids: ['a', 'b'], to: { c: 0.2 } },
        { ids: ['b'], to: { c: 1 } },
        { ids: ['a'], to: { b: true } },
      ],
      'import',
    );
    expect(ch!.kind).toBe('import');
    expect(ch!.items).toEqual([{ id: 'a', from: { c: 1 }, to: { b: true } }]);
    expect(store.state().values.a).toEqual({ b: true });
  });

  it('ID, которых нет в каталоге, хранятся и переживают перезапуск', () => {
    const store = openStore({ dataDir, seedFile });
    store.apply([{ ids: ['gone_from_wiki_tank'], to: { c: 0.4 } }], 'edit');
    expect(openStore({ dataDir, seedFile }).state().values.gone_from_wiki_tank).toEqual({ c: 0.4 });
  });

  it('недопустимое значение — ошибка, ничего не записано', () => {
    const store = openStore({ dataDir, seedFile });
    expect(() => store.apply([{ ids: ['a'], to: { c: 11 } }], 'edit')).toThrow();
    expect(store.state().version).toBe(0);
  });

  it('запись атомарная: временных файлов не остаётся, оба файла — валидный JSON', () => {
    const store = openStore({ dataDir, seedFile });
    store.apply([{ ids: ['a'], to: { c: 0.3 } }], 'edit');
    expect(readdirSync(dataDir).sort()).toEqual(['changes.json', 'values.json']);
    expect(readJson(join(dataDir, 'values.json'))).toEqual({ a: { c: 0.3 } });
    expect(readJson(join(dataDir, 'changes.json'))).toHaveLength(1);
  });
});

describe('история', () => {
  it('обрезается до historyCap; state отдаёт limit новых первыми', () => {
    const store = openStore({ dataDir, seedFile, historyCap: 5 });
    for (let i = 1; i <= 8; i++) store.apply([{ ids: ['a'], to: { c: i / 10 } }], 'edit');
    const all = store.state(100);
    expect(all.version).toBe(8);
    expect(all.changes.map((c) => c.seq)).toEqual([8, 7, 6, 5, 4]);
    expect(store.state(2).changes.map((c) => c.seq)).toEqual([8, 7]);
    expect(readJson(join(dataDir, 'changes.json'))).toHaveLength(5);
    // после перезапуска счёт продолжается
    const again = openStore({ dataDir, seedFile, historyCap: 5 });
    expect(again.apply([{ ids: ['a'], to: { c: 1 } }], 'edit')!.seq).toBe(9);
  });

  it('по умолчанию API отдаёт 100, файл хранит 1000', () => {
    // 998 записей уже в истории (как после долгой работы) — 1000 атомарных записей подряд слишком медленны.
    openStore({ dataDir, seedFile });
    const at = new Date(0).toISOString();
    const prior = Array.from({ length: 998 }, (_, i) => ({
      seq: i + 1,
      at,
      kind: 'edit',
      items: [{ id: 'a', from: i % 2 ? { b: true } : { c: 1 }, to: i % 2 ? { c: 1 } : { b: true } }],
    }));
    writeFileSync(join(dataDir, 'changes.json'), JSON.stringify(prior));
    writeFileSync(join(dataDir, 'values.json'), JSON.stringify({ a: { c: 1 } }));

    const store = openStore({ dataDir, seedFile });
    expect(store.state().version).toBe(998);
    for (let i = 0; i < 7; i++) store.apply([{ ids: ['a'], to: i % 2 ? { c: 1 } : { b: true } }], 'edit');
    const s = store.state();
    expect(s.version).toBe(1005);
    expect(s.changes).toHaveLength(100);
    expect(s.changes[0].seq).toBe(1005);
    expect(s.changes[99].seq).toBe(906);
    const file = readJson(join(dataDir, 'changes.json')) as { seq: number }[];
    expect(file).toHaveLength(1000);
    expect(file[0].seq).toBe(6);
    expect(file[999].seq).toBe(1005);
  });
});

describe('undo', () => {
  it('возвращает «было» и пишет запись undo с undoOf', () => {
    writeFileSync(seedFile, JSON.stringify({ a: { c: 0.8 } }));
    const store = openStore({ dataDir, seedFile });
    store.apply([{ ids: ['a', 'b'], to: { b: true } }], 'edit');
    store.apply([{ ids: ['c'], to: { c: 0.2 } }], 'edit');
    const u = store.undo(1);
    expect(u!.kind).toBe('undo');
    expect(u!.undoOf).toBe(1);
    expect(u!.seq).toBe(3);
    expect(u!.items).toEqual([
      { id: 'a', from: { b: true }, to: { c: 0.8 } },
      { id: 'b', from: { b: true }, to: { c: 1 } },
    ]);
    const v = store.state().values;
    expect(v.a).toEqual({ c: 0.8 });
    expect(v.b ?? { c: 1 }).toEqual({ c: 1 });
    expect(v.c).toEqual({ c: 0.2 });
  });

  it('неизвестный seq → NotFoundError', () => {
    const store = openStore({ dataDir, seedFile });
    expect(() => store.undo(42)).toThrow(NotFoundError);
  });

  it('повторная отмена той же записи ничего не меняет', () => {
    const store = openStore({ dataDir, seedFile });
    store.apply([{ ids: ['a'], to: { c: 0.5 } }], 'edit');
    store.undo(1);
    expect(store.undo(1)).toBeNull();
    expect(store.state().version).toBe(2);
  });

  it('отмену не отменяют', () => {
    const store = openStore({ dataDir, seedFile });
    store.apply([{ ids: ['a'], to: { c: 0.5 } }], 'edit');
    store.undo(1);
    expect(store.undo(2)).toBeNull();
    expect(store.state().version).toBe(2);
    expect(store.state().values.a ?? { c: 1 }).toEqual({ c: 1 });
  });

  it('не затирает более позднюю правку той же машины', () => {
    const store = openStore({ dataDir, seedFile });
    store.apply([{ ids: ['a', 'b'], to: { c: 0.5 } }], 'edit');
    store.apply([{ ids: ['a'], to: { c: 0.8 } }], 'edit');
    const u = store.undo(1);
    expect(u!.items).toEqual([{ id: 'b', from: { c: 0.5 }, to: { c: 1 } }]);
    expect(store.state().values.a).toEqual({ c: 0.8 });
  });

  it('все машины записи потом меняли — отмена ничего не пишет', () => {
    const store = openStore({ dataDir, seedFile });
    store.apply([{ ids: ['a'], to: { c: 0.5 } }], 'edit');
    store.apply([{ ids: ['a'], to: { c: 0.8 } }], 'edit');
    expect(store.undo(1)).toBeNull();
    expect(store.state().version).toBe(2);
  });
});

it('папка данных создаётся, если её нет', () => {
  const deep = join(root, 'x', 'y');
  openStore({ dataDir: deep, seedFile });
  expect(existsSync(join(deep, 'values.json'))).toBe(true);
});
