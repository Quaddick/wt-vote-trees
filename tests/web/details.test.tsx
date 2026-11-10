import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editMode, installEditor } from '../../src/state';
import { fake, resetFake } from './fake-api';
import { card, closePage, openPage } from './harness';

vi.mock('../../src/api', () => import('./fake-api'));

beforeEach(() => {
  resetFake();
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  closePage();
  installEditor({});
});

describe('подробности машины', () => {
  it('клик по карточке — имя RU/EN, ранг, БР АБ/РБ/СБ, класс, значение, последняя правка, ссылка на вики', async () => {
    fake.state = {
      version: 1,
      values: { ussr_t_34_1941: { c: 0.8 } },
      changes: [{ seq: 1, at: new Date().toISOString(), kind: 'edit', items: [{ id: 'ussr_t_34_1941', from: { c: 1 }, to: { c: 0.8 } }] }],
    };
    await openPage('#ussr');
    await waitFor(() => expect(card('ussr_t_34_1941').getAttribute('data-value')).toBe('0.8'));
    fireEvent.click(card('ussr_t_34_1941'));

    const dlg = within(screen.getByRole('dialog', { name: 'Т-34 (1941)' }));
    expect(dlg.getByText('T-34 (1941)')).toBeTruthy();
    expect(dlg.getByText('Ранг I')).toBeTruthy();
    expect(dlg.getByText('АБ 4.0 · РБ 3.7 · СБ 3.7')).toBeTruthy();
    expect(dlg.getByText('Исследуемая')).toBeTruthy();
    expect(dlg.getByTestId('details-value').textContent).toBe('0.8');
    expect(dlg.getByTestId('details-last').textContent).toMatch(/^1 → 0\.8 · \d\d:\d\d$/);
    expect(dlg.queryByRole('link')).toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('имя EN рядом с RU; без правок — «Правок не было»; отряд и нет БР', async () => {
    await openPage('#ussr');
    fireEvent.click(card('ussr_buk_launcher'));
    const dlg = within(screen.getByRole('dialog', { name: 'Бук ПУ' }));
    expect(dlg.getByText('Buk TEL')).toBeTruthy();
    expect(dlg.getByText('БР —')).toBeTruthy();
    expect(dlg.getByTestId('details-last').textContent).toBe('Правок не было');
    fireEvent.click(dlg.getByRole('button', { name: 'Закрыть' }));

    fireEvent.click(card('ussr_bmp_2m'));
    expect(within(screen.getByRole('dialog')).getByText('Отрядная')).toBeTruthy();
  });
});

describe('точка подключения режима правки', () => {
  it('в режиме правки клик по карточке уходит редактору, панель и кнопки шапки рисуются в своих местах', async () => {
    const onCardClick = vi.fn();
    installEditor({
      onCardClick,
      Panel: () => <div data-testid="edit-panel">панель</div>,
      Toolbar: () => <button type="button">Вход</button>,
      ChangeActions: ({ change }) => <button type="button">Отменить {change.seq}</button>,
    });
    fake.state = {
      version: 1,
      values: {},
      changes: [{ seq: 7, at: new Date().toISOString(), kind: 'edit', items: [{ id: 'ussr_t_26', from: { c: 1 }, to: { c: 0.5 } }] }],
    };
    await openPage('#ussr');
    expect(screen.getByTestId('edit-panel')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Вход' })).toBeTruthy();
    await screen.findByRole('button', { name: 'Отменить 7' });

    // вне режима правки — подробности
    fireEvent.click(card('ussr_t_26'));
    expect(onCardClick).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });

    editMode.value = true;
    fireEvent.click(card('ussr_t_26'), { ctrlKey: true });
    expect(onCardClick).toHaveBeenCalledTimes(1);
    expect(onCardClick.mock.calls[0][0]).toBe('ussr_t_26');
    expect((onCardClick.mock.calls[0][1] as MouseEvent).ctrlKey).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
