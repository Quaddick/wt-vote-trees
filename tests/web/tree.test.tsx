import { readFileSync } from 'node:fs';
import { fireEvent, screen, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TreeCatalog } from '../../shared/types';
import { fake, resetFake } from './fake-api';
import { card, closePage, openPage } from './harness';

vi.mock('../../src/api', () => import('./fake-api'));

const realCatalog = JSON.parse(readFileSync('public/catalog/trees.json', 'utf8')) as TreeCatalog;

beforeEach(() => resetFake());
afterEach(closePage);

describe('вкладки наций и дерево', () => {
  it('10 вкладок с флагами в порядке каталога; у каждой нации столько рангов, сколько в каталоге', async () => {
    resetFake(realCatalog);
    await openPage();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent?.trim())).toEqual([
      'США', 'Германия', 'СССР', 'Великобритания', 'Япония', 'Китай', 'Италия', 'Франция', 'Швеция', 'Израиль',
    ]);
    for (const [i, tab] of tabs.entries()) {
      expect(tab.querySelector('img')?.getAttribute('src')).toBe(`catalog/flags/${realCatalog.nations[i].code}.svg`);
    }
    for (const [i, n] of realCatalog.nations.entries()) {
      fireEvent.click(tabs[i]);
      expect(tabs[i].getAttribute('aria-selected')).toBe('true');
      expect(document.querySelectorAll('[data-rank-band]').length).toBe(n.ranks.length);
    }
    // у Израиля ранги начинаются с IV
    expect(screen.getByText('Ранг IV')).toBeTruthy();
    expect(screen.queryByText('Ранг I')).toBeNull();
  });

  it('ячейки стоят по строкам и колонкам каталога, группа — рамка с машинами по порядку', async () => {
    await openPage('#ussr');
    // ранг 1: строка 0 — Т-26 (колонка 0), БТ-5 (колонка 1); строка 1 — группа Т-34 (колонка 0)
    const t26 = card('ussr_t_26').closest<HTMLElement>('[data-cell]')!;
    const bt5 = card('ussr_bt_5').closest<HTMLElement>('[data-cell]')!;
    const group = document.querySelector<HTMLElement>('[data-cell="g:ussr_t_34_group"]')!;
    expect(t26.style.gridColumnStart).toBe('1');
    expect(bt5.style.gridColumnStart).toBe('2');
    expect(bt5.style.gridRowStart).toBe(t26.style.gridRowStart);
    expect(group.style.gridColumnStart).toBe('1');
    expect(Number(group.style.gridRowStart)).toBe(Number(t26.style.gridRowStart) + 1);
    const inGroup = [...group.querySelectorAll('[data-vid]')].map((e) => e.getAttribute('data-vid'));
    expect(inGroup).toEqual(['ussr_t_34_1940', 'ussr_t_34_1941']);
  });

  it('линии соединяют ячейку с её req, в том числе через ранги', async () => {
    await openPage('#ussr');
    const edges = [...document.querySelectorAll('[data-edge]')].map((e) => e.getAttribute('data-edge')).sort();
    expect(edges).toEqual(['g:ussr_t_34_group>v:ussr_is_2_1944', 'v:ussr_t_26>g:ussr_t_34_group']);
  });

  it('премиум и отряд — правый блок «Премиумная техника», разные классы карточек', async () => {
    await openPage('#ussr');
    const premiumBlock = screen.getByText('Премиумная техника');
    expect(premiumBlock).toBeTruthy();
    expect(card('ussr_bmp_2m').className).toMatch(/\bcard--squad\b/);
    expect(card('ussr_t_80u_yt_cup_2019').className).toMatch(/\bcard--premium\b/);
    expect(card('ussr_t_26').className).toMatch(/\bcard--research\b/);
    const prem = card('ussr_bmp_2m').closest<HTMLElement>('[data-cell]')!;
    // премиум — правее всех исследуемых колонок (2 колонки + разделитель)
    expect(Number(prem.style.gridColumnStart)).toBeGreaterThan(2);
  });

  it('переключение вкладки без перезагрузки пишет хэш', async () => {
    await openPage('#ussr');
    fireEvent.click(within(screen.getByRole('tablist')).getByText('Израиль'));
    expect(location.hash).toBe('#il');
    expect(card('il_m_51')).toBeTruthy();
    expect(fake.catalog.nations.length).toBe(2);
  });
});
