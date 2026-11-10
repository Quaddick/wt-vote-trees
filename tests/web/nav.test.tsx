import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fake, resetFake } from './fake-api';
import { card, closePage, openPage } from './harness';

vi.mock('../../src/api', () => import('./fake-api'));

const scrollIntoView = vi.fn();

function setWidth(narrow: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: narrow && query.includes('max-width: 767px'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  resetFake();
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
  setWidth(false);
});
afterEach(closePage);

describe('ссылки #nation/id', () => {
  it('открывают нацию и подсвечивают машину', async () => {
    await openPage('#ussr/ussr_t_34_1940');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'СССР' }).getAttribute('aria-selected')).toBe('true'));
    expect(card('ussr_t_34_1940').className).toMatch(/\bis-flash\b/);
    await waitFor(() => expect(scrollIntoView.mock.contexts).toContain(card('ussr_t_34_1940')));
  });

  it('смена хэша в открытой странице переключает нацию', async () => {
    await openPage('#ussr');
    history.replaceState(null, '', '/#il');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Израиль' }).getAttribute('aria-selected')).toBe('true'));
  });
});

describe('вид «Дерево | Список»', () => {
  it('на широком экране по умолчанию дерево, переключатель ведёт в список: иконка, имя, БР, значение по рангам', async () => {
    fake.state = { version: 1, values: { ussr_is_2_1944: { b: true } }, changes: [] };
    await openPage('#ussr');
    const toggle = within(screen.getByRole('group', { name: 'Вид' }));
    expect(toggle.getByRole('button', { name: 'Дерево' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.tree')).not.toBeNull();

    fireEvent.click(toggle.getByRole('button', { name: 'Список' }));
    expect(document.querySelector('.tree')).toBeNull();
    const rank2 = within(screen.getByRole('region', { name: 'Ранг II' }));
    const row = rank2.getByText('ИС-2 обр. 1944').closest<HTMLElement>('[data-vid]')!;
    expect(row.querySelector('img')?.getAttribute('src')).toBe('catalog/slots/ussr_is_2_1944.webp');
    expect(within(row).getByText('6.7')).toBeTruthy();
    expect(within(row).getByText('✕')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Ранг I' })).toBeTruthy();
  });

  it('на узком экране (< 768 px) по умолчанию список, переключатель есть', async () => {
    setWidth(true);
    await openPage('#ussr');
    const toggle = within(screen.getByRole('group', { name: 'Вид' }));
    expect(toggle.getByRole('button', { name: 'Список' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.tree')).toBeNull();
    expect(card('ussr_t_26')).toBeTruthy();
  });
});
