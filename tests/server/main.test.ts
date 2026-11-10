import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'wtv-main-'));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

/** Запускает server/main.ts, ждёт адрес в логе (или выход процесса). */
function run(env: Record<string, string>) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/main.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: '0', ADMIN_PASSWORD: '', SESSION_SECRET: '', TRUSTED_PROXIES: '', STATIC_DIR: join(tmp, 'no-dist'), ...env },
  });
  let out = '';
  let stdout = '';
  child.stdout.on('data', (d) => {
    out += d;
    stdout += d;
  });
  child.stderr.on('data', (d) => (out += d));
  const exited = new Promise<number | null>((r) => child.on('exit', (code) => r(code)));
  const ready = new Promise<string>((res, rej) => {
    const timer = setInterval(() => {
      // Только целая строка лога: кусок stdout может оборваться посреди номера порта.
      const m = /http:\/\/localhost:(\d+)\r?\n/.exec(stdout);
      if (m) {
        clearInterval(timer);
        res(`http://127.0.0.1:${m[1]}`);
      }
    }, 50);
    exited.then(() => {
      clearInterval(timer);
      rej(new Error('процесс завершился'));
    });
  });
  return { child, ready, exited, log: () => out };
}

it('первый запуск без seed и без пароля: стартует, отдаёт пустые значения, предупреждает в лог', async () => {
  const p = run({ DATA_DIR: join(tmp, 'runtime'), SEED_FILE: join(tmp, 'missing.json') });
  try {
    const base = await p.ready;
    const state = await (await fetch(base + '/api/state')).json();
    expect(state).toEqual({ version: 0, values: {}, changes: [] });
    expect(await (await fetch(base + '/api/me')).json()).toEqual({ editor: false, editingEnabled: false });
    expect(p.log()).toMatch(/ADMIN_PASSWORD/);
    expect(p.log()).toContain(join(tmp, 'missing.json'));
  } finally {
    p.child.kill();
    await p.exited;
  }
}, 20_000);

it('битый values.json: процесс не стартует, в ошибке путь, файл цел', async () => {
  const dataDir = join(tmp, 'runtime');
  mkdirSync(dataDir);
  const file = join(dataDir, 'values.json');
  writeFileSync(file, '{ broken');
  const p = run({ DATA_DIR: dataDir, SEED_FILE: join(tmp, 'missing.json') });
  p.ready.catch(() => {});
  const code = await p.exited;
  expect(code).not.toBe(0);
  expect(p.log()).toContain(file);
  expect(readFileSync(file, 'utf8')).toBe('{ broken');
}, 20_000);
