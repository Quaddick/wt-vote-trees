import { describe, expect, it } from 'vitest';
import { planTiles } from '../../scripts/seed/tiles';

describe('planTiles', () => {
  it('режет по ~600 px с перекрытием ~80 px и покрывает всю высоту', () => {
    const tiles = planTiles(2000);
    expect(tiles[0].y0).toBe(0);
    expect(tiles[tiles.length - 1].y1).toBe(2000);
    for (let i = 1; i < tiles.length; i++) {
      const overlap = tiles[i - 1].y1 - tiles[i].y0;
      expect(overlap).toBeGreaterThanOrEqual(80);
      expect(overlap).toBeLessThanOrEqual(100);
    }
    for (const t of tiles) expect(t.y1 - t.y0).toBeLessThanOrEqual(750);
    expect(tiles.length).toBe(4);
  });

  it('низкая картинка — один фрагмент', () => {
    expect(planTiles(500)).toEqual([{ y0: 0, y1: 500 }]);
  });

  it('не оставляет крошечный хвост', () => {
    const tiles = planTiles(1200);
    const last = tiles[tiles.length - 1];
    expect(last.y1 - last.y0).toBeGreaterThanOrEqual(300);
    expect(last.y1).toBe(1200);
  });
});
