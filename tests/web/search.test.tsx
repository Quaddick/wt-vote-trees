import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFake } from './fake-api';
import { card, closePage, openPage } from './harness';

vi.mock('../../src/api', () => import('./fake-api'));

const scrollIntoView = vi.fn();

beforeEach(() => {
  resetFake();
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterEach(closePage);

function box() {
  return screen.getByRole('searchbox', { name: 'Поиск машины' });
}

function options() {
  return within(screen.getByRole('listbox')).queryAllByRole('option').map((o) => o.getAttribute('data-result'));
}

describe('поиск по всем нациям', () => {
  it('«/» ставит курсор в поиск', async () => {
    await openPage('#ussr');
    fireEvent.keyDown(document.body, { key: '/' });
    expect(document.activeElement).toBe(box());
  });

  it('ищет по русскому и английскому имени без регистра, дефисов и пробелов — во всех нациях', async () => {
    await openPage('#ussr');
    fireEvent.input(box(), { target: { value: 'т34' } });
    expect(options().sort()).toEqual(['il_t_34', 'ussr_t_34_1940', 'ussr_t_34_1941']);

    fireEvent.input(box(), { target: { value: 'is 2' } });
    expect(options()).toEqual(['ussr_is_2_1944']);

    fireEvent.input(box(), { target: { value: 'ИС-2' } });
    expect(options()).toEqual(['ussr_is_2_1944']);
  });

  it('выбор — вкладка нации, адрес, прокрутка к карточке и вспышка', async () => {
    await openPage('#ussr');
    fireEvent.input(box(), { target: { value: 'израиль' } });
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option'));

    expect(screen.getByRole('tab', { name: 'Израиль' }).getAttribute('aria-selected')).toBe('true');
    expect(location.hash).toBe('#il/il_t_34');
    expect(card('il_t_34').className).toMatch(/\bis-flash\b/);
    await waitFor(() => expect(scrollIntoView.mock.contexts).toContain(card('il_t_34')));
  });

  it('Enter выбирает первый результат', async () => {
    await openPage('#il');
    fireEvent.input(box(), { target: { value: 'bt-5' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(location.hash).toBe('#ussr/ussr_bt_5');
  });

  it('пусто — «Ничего не нашлось»', async () => {
    await openPage('#ussr');
    fireEvent.input(box(), { target: { value: 'Абрамс' } });
    expect(screen.getByText('Ничего не нашлось')).toBeTruthy();
  });
});
