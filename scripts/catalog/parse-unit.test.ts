import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBattleRating } from './parse-unit';

const fixture = (name: string) => readFileSync(join(import.meta.dirname, '__fixtures__', name), 'utf8');

describe('parseBattleRating', () => {
  it('страница машины — БР АБ/РБ/СБ (M-51: 6.3 во всех режимах)', () => {
    expect(parseBattleRating(fixture('unit_il_m_51.html'))).toEqual({ ab: 6.3, rb: 6.3, sb: 6.3 });
  });

  it('разные значения режимов не путаются', () => {
    const html = `<div class="game-unit_card-info_item game-unit_br"><div class="game-unit_card-info_value">
      <div class="game-unit_br-item"><div class="mode">SB</div><div class="value">11.0</div></div>
      <div class="game-unit_br-item"><div class="mode">AB</div><div class="value">10.7</div></div>
      <div class="game-unit_br-item"><div class="mode">RB</div><div class="value">11.3</div></div>
    </div></div>`;
    expect(parseBattleRating(html)).toEqual({ ab: 10.7, rb: 11.3, sb: 11 });
  });

  it('страница без блока БР — null', () => {
    expect(parseBattleRating(fixture('unit_no_br.html'))).toBeNull();
  });

  it('нет одного из режимов или значение не число — null', () => {
    const only = (sb: string) => `<div class="game-unit_br">
      <div class="game-unit_br-item"><div class="mode">AB</div><div class="value">1.0</div></div>
      <div class="game-unit_br-item"><div class="mode">RB</div><div class="value">1.0</div></div>${sb}</div>`;
    expect(parseBattleRating(only(''))).toBeNull();
    expect(parseBattleRating(only('<div class="game-unit_br-item"><div class="mode">SB</div><div class="value">—</div></div>'))).toBeNull();
  });
});
