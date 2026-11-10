import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runTiles } from '../../scripts/seed/tiles';

let dir: string;

async function makePng(file: string, width: number, height: number): Promise<void> {
  await sharp({ create: { width, height, channels: 3, background: '#223' } }).png().toFile(file);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tiles-test-'));
  await mkdir(join(dir, 'images'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('runTiles', () => {
  it('режет каждый скриншот в папку нации и пишет index.json с диапазонами', async () => {
    await makePng(join(dir, 'images', 'DE.png'), 100, 1500);
    await makePng(join(dir, 'images', 'GB.png'), 100, 400);
    const out = join(dir, 'tiles');
    const done = await runTiles({ imagesDir: join(dir, 'images'), outDir: out });

    expect(done.map((d) => d.nation).sort()).toEqual(['germ', 'uk']);

    const index = JSON.parse(await readFile(join(out, 'germ', 'index.json'), 'utf8'));
    expect(index.nation).toBe('germ');
    expect(index.source).toBe('images/DE.png');
    expect(index.width).toBe(100);
    expect(index.height).toBe(1500);
    expect(index.scale).toBe(2);
    expect(index.tiles.length).toBe(3);
    expect(index.tiles[0]).toMatchObject({ file: '01.png', y0: 0 });
    expect(index.tiles[index.tiles.length - 1].y1).toBe(1500);
    expect(index.tiles[1].y0).toBeLessThan(index.tiles[0].y1); // перекрытие

    const files = (await readdir(join(out, 'germ'))).sort();
    expect(files).toEqual(['01.png', '02.png', '03.png', 'index.json']);

    // файл фрагмента увеличен вдвое
    const meta = await sharp(join(out, 'germ', '01.png')).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe((index.tiles[0].y1 - index.tiles[0].y0) * 2);

    expect((await readdir(join(out, 'uk'))).sort()).toEqual(['01.png', 'index.json']);
  });

  it('повторный запуск убирает фрагменты прошлой нарезки', async () => {
    const out = join(dir, 'tiles');
    await makePng(join(dir, 'images', 'DE.png'), 100, 1500);
    await runTiles({ imagesDir: join(dir, 'images'), outDir: out });
    await makePng(join(dir, 'images', 'DE.png'), 100, 400);
    await runTiles({ imagesDir: join(dir, 'images'), outDir: out });
    expect((await readdir(join(out, 'germ'))).sort()).toEqual(['01.png', 'index.json']);
  });

  it('файл с неизвестным именем пропускает', async () => {
    await makePng(join(dir, 'images', 'XX.png'), 100, 100);
    const done = await runTiles({ imagesDir: join(dir, 'images'), outDir: join(dir, 'tiles') });
    expect(done).toEqual([]);
  });
});
