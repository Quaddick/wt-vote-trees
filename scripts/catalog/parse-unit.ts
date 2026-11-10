/**
 * Разбор страницы машины вики (`/unit/<id>`): боевой рейтинг по режимам.
 * Разметка (2026-11): `.game-unit_br .game-unit_br-item` с `.mode` (AB/RB/SB) и `.value` («6.3»).
 */
import { parse } from 'node-html-parser';
import type { BattleRating } from '../../shared/types';

/** БР АБ/РБ/СБ; нет блока, нет одного из режимов или значение не число — null. */
export function parseBattleRating(html: string): BattleRating | null {
  const block = parse(html).querySelector('.game-unit_br');
  if (!block) return null;
  const modes = new Map<string, number>();
  for (const item of block.querySelectorAll('.game-unit_br-item')) {
    const mode = item.querySelector('.mode')?.text.trim().toUpperCase();
    const raw = item.querySelector('.value')?.text.trim().replace(',', '.') ?? '';
    const value = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : Number.NaN;
    if (mode && Number.isFinite(value) && value > 0) modes.set(mode, value);
  }
  const ab = modes.get('AB');
  const rb = modes.get('RB');
  const sb = modes.get('SB');
  return ab !== undefined && rb !== undefined && sb !== undefined ? { ab, rb, sb } : null;
}
