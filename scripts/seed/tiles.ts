/**
 * Нарезка скриншотов деревьев для читателей.
 *
 *   npm run seed:tiles   — images/*.png → data/seed/tiles/<nation>/NN.png + index.json
 *
 * Фрагмент — ~600 px исходника по высоте, соседние перекрываются на ~80 px, каждый увеличен вдвое:
 * мелкие цифры коэффициентов на скриншотах иначе читаются с ошибками. Перекрытие нужно, чтобы карточка,
 * разрезанная границей, целиком попала хотя бы в один фрагмент.
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

export const TILE_HEIGHT = 600;
export const TILE_OVERLAP = 80;
export const TILE_SCALE = 2;
/** Хвост ниже этого порога приклеивается к предыдущему фрагменту, а не режется отдельно. */
const MIN_TAIL = 150;

/** Имя файла скриншота (без расширения, без учёта регистра) → код нации. */
export const SCREENSHOT_NATIONS: Record<string, string> = {
  us: 'us',
  de: 'germ',
  ussr: 'ussr',
  gb: 'uk',
  jp: 'jp',
  cn: 'cn',
  it: 'it',
  fr: 'fr',
  sw: 'sw',
  il: 'il',
};

export interface TileRange {
  y0: number;
  y1: number;
}

/** Диапазоны высоты фрагментов: шаг TILE_HEIGHT − TILE_OVERLAP, последний доходит до низа картинки. */
export function planTiles(height: number): TileRange[] {
  const tiles: TileRange[] = [];
  let y0 = 0;
  for (;;) {
    let y1 = Math.min(y0 + TILE_HEIGHT, height);
    if (height - y1 < MIN_TAIL) y1 = height;
    tiles.push({ y0, y1 });
    if (y1 >= height) break;
    y0 = y1 - TILE_OVERLAP;
  }
  return tiles;
}

export interface TilesIndex {
  nation: string;
  source: string;
  width: number;
  height: number;
  scale: number;
  tiles: { file: string; y0: number; y1: number; outWidth: number; outHeight: number }[];
}

export interface RunTilesOptions {
  imagesDir: string;
  outDir: string;
}

/** Режет все известные скриншоты из imagesDir; неизвестные файлы пропускает. Возвращает индексы по нациям. */
export async function runTiles(opts: RunTilesOptions): Promise<TilesIndex[]> {
  const files = (await readdir(opts.imagesDir)).filter((f) => extname(f).toLowerCase() === '.png').sort();
  const done: TilesIndex[] = [];
  for (const file of files) {
    const nation = SCREENSHOT_NATIONS[basename(file, extname(file)).toLowerCase()];
    if (!nation) continue;

    const meta = await sharp(join(opts.imagesDir, file)).metadata();
    if (!meta.width || !meta.height) throw new Error(`Не прочитать размеры ${file}`);
    const nationDir = join(opts.outDir, nation);
    await rm(nationDir, { recursive: true, force: true }); // фрагменты прошлой нарезки не должны остаться
    await mkdir(nationDir, { recursive: true });

    const index: TilesIndex = { nation, source: `images/${file}`, width: meta.width, height: meta.height, scale: TILE_SCALE, tiles: [] };
    const ranges = planTiles(meta.height);
    for (const [i, r] of ranges.entries()) {
      const name = `${String(i + 1).padStart(2, '0')}.png`;
      const outWidth = meta.width * TILE_SCALE;
      const outHeight = (r.y1 - r.y0) * TILE_SCALE;
      await sharp(join(opts.imagesDir, file))
        .extract({ left: 0, top: r.y0, width: meta.width, height: r.y1 - r.y0 })
        .resize({ width: outWidth, height: outHeight, kernel: 'lanczos3' })
        .png()
        .toFile(join(nationDir, name));
      index.tiles.push({ file: name, y0: r.y0, y1: r.y1, outWidth, outHeight });
    }
    await writeFile(join(nationDir, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');
    done.push(index);
  }
  return done;
}

async function main(): Promise<void> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const imagesDir = join(root, 'images');
  if (!existsSync(imagesDir)) throw new Error(`Нет папки со скриншотами: ${imagesDir}`);
  const done = await runTiles({ imagesDir, outDir: join(root, 'data/seed/tiles') });
  for (const d of done) console.log(`${d.nation}: ${d.tiles.length} фрагментов (${d.source}, ${d.width}×${d.height})`);
  const missing = Object.values(SCREENSHOT_NATIONS).filter((n) => !done.some((d) => d.nation === n));
  if (missing.length > 0) {
    console.error(`Нет скриншотов для наций: ${missing.join(', ')}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
