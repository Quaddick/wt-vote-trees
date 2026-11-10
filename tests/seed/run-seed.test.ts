import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runSeed } from '../../scripts/seed/match';

let dir: string;

const catalog = {
  version: 1,
  generatedAt: '2026-01-01T00:00:00Z',
  nations: [
    { code: 'us', nameRu: 'США', flag: 'flags/us.svg', researchColumns: 1, premiumColumns: 1, ranks: [] },
    { code: 'il', nameRu: 'Израиль', flag: 'flags/il.svg', researchColumns: 1, premiumColumns: 1, ranks: [] },
  ],
  vehicles: {
    il_m51: { id: 'il_m51', nation: 'il', name: 'M-51', nameRu: 'M-51', nameEn: 'M-51', cls: 'research', rank: 4, br: null, req: null, hasSlot: true },
    il_new: { id: 'il_new', nation: 'il', name: 'Novyi Tank', nameRu: 'Novyi Tank', nameEn: 'Novyi Tank', cls: 'research', rank: 6, br: null, req: null, hasSlot: true },
    us_m2a4: { id: 'us_m2a4', nation: 'us', name: 'M2A4', nameRu: 'M2A4', nameEn: 'M2A4', cls: 'research', rank: 1, br: null, req: null, hasSlot: true },
  },
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'seed-test-'));
  await mkdir(join(dir, 'raw'));
  await writeFile(join(dir, 'trees.json'), JSON.stringify(catalog));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function opts() {
  return {
    rawDir: join(dir, 'raw'),
    catalogFile: join(dir, 'trees.json'),
    valuesFile: join(dir, 'out', 'values.json'),
    reportFile: join(dir, 'out', 'report.md'),
  };
}

describe('runSeed', () => {
  it('пишет values.json и отчёт: несопоставленные, машины без значения, спорные места, число карточек', async () => {
    await writeFile(
      join(dir, 'raw', 'il.json'),
      JSON.stringify({
        nation: 'il',
        source: 'images/IL.png',
        items: [
          { rank: 4, section: 'research', name: 'M-51', value: '0.5', doubt: 'цифра смазана, 0.5 или 0.3' },
          { rank: 2, section: 'research', name: 'Ghost Tank', value: 'x' },
        ],
      }),
    );
    const { values } = await runSeed(opts());

    expect(JSON.parse(await readFile(opts().valuesFile, 'utf8'))).toEqual({ il_m51: { c: 0.5 } });
    expect(values).toEqual({ il_m51: { c: 0.5 } });

    const report = await readFile(opts().reportFile, 'utf8');
    expect(report).toContain('Израиль');
    expect(report).toMatch(/Ghost Tank/); // несопоставленная
    expect(report).toMatch(/Novyi Tank/); // машина вики без значения
    expect(report).toContain('цифра смазана, 0.5 или 0.3'); // doubt
    expect(report).toMatch(/Карточек на скриншоте:\s*2/);
    expect(report).toMatch(/США[\s\S]*нет файла/); // нация без raw названа
    expect(report).toContain('M2A4'); // и её машины перечислены как без значения
  });

  it('битый raw — ошибка с путём, выходные файлы не создаются', async () => {
    await writeFile(join(dir, 'raw', 'il.json'), JSON.stringify({ nation: 'il', items: [{ rank: 4, section: 'research', name: 'M-51', value: 'abc' }] }));
    await expect(runSeed(opts())).rejects.toThrow(/il.*M-51/s);
    await expect(readFile(opts().valuesFile, 'utf8')).rejects.toThrow();
  });
  it('раздел «Как проверяли»: числа строк и расхождений из verify-файлов; verify не читается как нация', async () => {
    await mkdir(join(dir, 'verify'));
    await writeFile(join(dir, 'raw', 'il.json'), JSON.stringify({ nation: 'il', items: [{ rank: 4, section: 'research', name: 'M-51', value: '1' }] }));
    await writeFile(join(dir, 'verify', 'verify-a.json'), JSON.stringify({ checked: { il: 57, us: 154 }, mismatches: [] }));
    await writeFile(
      join(dir, 'verify', 'verify-b.json'),
      JSON.stringify({ checked: { il: 3 }, mismatches: [{ nation: 'il', name: 'M-51', raw: '1', seen: '0.5', resolved: 'на скриншоте 1' }] }),
    );
    await runSeed({ ...opts(), verifyDir: join(dir, 'verify') });
    const report = await readFile(opts().reportFile, 'utf8');
    expect(report).toContain('## Как проверяли');
    expect(report).toMatch(/Израиль \(il\)\s*\|\s*57\s*\|\s*0\s*\|\s*3\s*\|\s*1/); // Израиль: читатель A 57 строк, 0 расхождений; B 3 строки, 1 расхождение
    expect(report).toMatch(/США \(us\)\s*\|\s*154\s*\|\s*0\s*\|\s*—/);
    expect(report).toContain('M-51'); // расхождение названо
  });
});
