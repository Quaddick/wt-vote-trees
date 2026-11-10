import { act, fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Change, Edit, StateResponse } from '../../shared/types';
import { applyEdit } from '../../shared/values';
import * as api from '../../tests/web/fake-api';
import { ApiError, fake, resetFake } from '../../tests/web/fake-api';
import { card, closePage, openPage } from '../../tests/web/harness';
import type * as RealApi from '../api';
import './index';

vi.mock('../api', () => import('../../tests/web/fake-api'));

/** «Сервер» в памяти: правка меняет fake.state, как настоящий. */
function serverApply(edits: Edit[], kind: 'edit' | 'import' = 'edit'): StateResponse {
  let values = fake.state.values;
  const items: Change['items'] = [];
  for (const e of edits) {
    const r = applyEdit(values, e);
    values = r.values;
    items.push(...r.items);
  }
  if (items.length === 0) return structuredClone(fake.state);
  const seq = fake.state.version + 1;
  fake.state = {
    version: seq,
    values,
    changes: [{ seq, at: new Date().toISOString(), kind, items }, ...fake.state.changes],
  };
  return structuredClone(fake.state);
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// fake-api объявляет vi.fn без параметров — здесь им настоящие подписи `src/api.ts`.
const sendEdit = api.sendEdit as unknown as Mock<typeof RealApi.sendEdit>;
const sendUndo = api.sendUndo as unknown as Mock<typeof RealApi.sendUndo>;
const login = api.login as unknown as Mock<typeof RealApi.login>;

beforeEach(() => {
  resetFake();
  sendEdit.mockReset();
  sendEdit.mockImplementation(async (edits: Edit[], kind?: 'edit' | 'import') => serverApply(edits, kind));
  sendUndo.mockReset();
  sendUndo.mockImplementation(async () => structuredClone(fake.state));
  login.mockReset();
  login.mockResolvedValue('ok');
  Element.prototype.scrollIntoView = () => {};
});
afterEach(closePage);

async function openAsEditor(values: StateResponse['values'] = {}) {
  fake.me = { editor: true, editingEnabled: true };
  fake.state = { version: 1, values, changes: [] };
  await openPage('#ussr');
  await screen.findByText('Режим правки');
}

function valueOn(id: string): string | null | undefined {
  return card(id).querySelector('.card-value, .card-cross')?.textContent;
}

function editPanel() {
  return within(screen.getByRole('region', { name: 'Правка значения' }));
}

describe('вход', () => {
  it('без разрешения на сервере кнопки «Вход» нет', async () => {
    fake.me = { editor: false, editingEnabled: false };
    await openPage('#ussr');
    await waitFor(() => expect(api.fetchMe).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Вход' })).toBeNull();
  });

  it('неверный пароль — «Неверный пароль», поле не очищается; верный — режим правки', async () => {
    fake.me = { editor: false, editingEnabled: true };
    await openPage('#ussr');
    fireEvent.click(await screen.findByRole('button', { name: 'Вход' }));
    const field = screen.getByLabelText('Пароль') as HTMLInputElement;
    login.mockResolvedValueOnce('wrong');
    fireEvent.input(field, { target: { value: 'not-it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(await screen.findByText('Неверный пароль')).toBeTruthy();
    expect(field.value).toBe('not-it');
    expect(screen.queryByText('Режим правки')).toBeNull();

    login.mockResolvedValueOnce('ok');
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(await screen.findByText('Режим правки')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeTruthy();
    expect(screen.queryByLabelText('Пароль')).toBeNull();
  });

  it('много попыток — «Слишком много попыток, подожди 10 минут»', async () => {
    fake.me = { editor: false, editingEnabled: true };
    await openPage('#ussr');
    fireEvent.click(await screen.findByRole('button', { name: 'Вход' }));
    login.mockResolvedValueOnce('too-many');
    fireEvent.input(screen.getByLabelText('Пароль'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(await screen.findByText('Слишком много попыток, подожди 10 минут')).toBeTruthy();
  });

  it('«Выйти» — снова режим зрителя', async () => {
    await openAsEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Выйти' }));
    await screen.findByRole('button', { name: 'Вход' });
    expect(api.logout).toHaveBeenCalled();
    expect(screen.queryByText('Режим правки')).toBeNull();
  });

  it('меню «⋯» (телефон): те же действия, закрывается по Escape и клику мимо', async () => {
    await openAsEditor();
    const more = screen.getByRole('button', { name: 'Ещё' });
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Скачать значения', 'Загрузить', 'Выйти']);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(more);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(more);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Выйти' }));
    await screen.findByRole('button', { name: 'Вход' });
    expect(api.logout).toHaveBeenCalled();
  });
});

describe('правка одной машины', () => {
  it('клик по карточке — панель с пресетами вместо подробностей', async () => {
    await openAsEditor();
    fireEvent.click(card('ussr_bt_5'));
    const labels = editPanel()
      .getAllByRole('button', { name: /^(1|0\.\d|✕ Блок)$/ })
      .map((b) => b.textContent);
    expect(labels).toEqual(['1', '0.8', '0.5', '0.4', '0.3', '0.2', '✕ Блок']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('пресет применяется сразу: «сохраняю…», затем значение с сервера', async () => {
    await openAsEditor();
    const gate = deferred<void>();
    sendEdit.mockImplementationOnce(async (edits: Edit[]) => {
      await gate.promise;
      return serverApply(edits);
    });
    fireEvent.click(card('ussr_bt_5'));
    fireEvent.click(editPanel().getByRole('button', { name: '0.5' }));
    expect(valueOn('ussr_bt_5')).toBe('0.5');
    expect(card('ussr_bt_5').textContent).toContain('сохраняю…');
    expect(sendEdit).toHaveBeenCalledWith([{ ids: ['ussr_bt_5'], to: { c: 0.5 } }]);
    await act(async () => gate.resolve());
    await waitFor(() => expect(card('ussr_bt_5').textContent).not.toContain('сохраняю…'));
    expect(valueOn('ussr_bt_5')).toBe('0.5');
  });

  it('«✕ Блок» ставит блок', async () => {
    await openAsEditor();
    fireEvent.click(card('ussr_t_26'));
    fireEvent.click(editPanel().getByRole('button', { name: '✕ Блок' }));
    expect(sendEdit).toHaveBeenCalledWith([{ ids: ['ussr_t_26'], to: { b: true } }]);
    await waitFor(() => expect(valueOn('ussr_t_26')).toBe('✕'));
  });

  it.each(['0', '11', 'abc'])('«свой» = %s — ошибка под полем, запрос не уходит, введённое остаётся', async (text) => {
    await openAsEditor();
    fireEvent.click(card('ussr_bt_5'));
    const field = editPanel().getByLabelText('Свой коэффициент') as HTMLInputElement;
    fireEvent.input(field, { target: { value: text } });
    fireEvent.click(editPanel().getByRole('button', { name: 'Применить' }));
    expect(editPanel().getByText('Коэффициент — число от 0.01 до 10')).toBeTruthy();
    expect(field.value).toBe(text);
    expect(sendEdit).not.toHaveBeenCalled();
  });

  it('«свой» = «0,25» принимается', async () => {
    await openAsEditor();
    fireEvent.click(card('ussr_bt_5'));
    const field = editPanel().getByLabelText('Свой коэффициент');
    fireEvent.input(field, { target: { value: '0,25' } });
    fireEvent.submit(field.closest('form')!);
    expect(sendEdit).toHaveBeenCalledWith([{ ids: ['ussr_bt_5'], to: { c: 0.25 } }]);
    await waitFor(() => expect(valueOn('ussr_bt_5')).toBe('0.25'));
  });

  it('сбой сохранения — карточка возвращается, тост «Не сохранилось: … Попробуй ещё раз»', async () => {
    await openAsEditor({ ussr_bt_5: { c: 0.8 } });
    sendEdit.mockRejectedValueOnce(new ApiError(0, 'нет связи с сервером'));
    fireEvent.click(card('ussr_bt_5'));
    fireEvent.click(editPanel().getByRole('button', { name: '0.3' }));
    expect(await screen.findByText('Не сохранилось: нет связи с сервером. Попробуй ещё раз')).toBeTruthy();
    expect(valueOn('ussr_bt_5')).toBe('0.8');
    expect(card('ussr_bt_5').textContent).not.toContain('сохраняю…');
    expect(screen.getByText('Режим правки')).toBeTruthy();
  });

  it('401 — «Сессия истекла — войди снова», правка не применена, режим зрителя', async () => {
    await openAsEditor();
    sendEdit.mockRejectedValueOnce(new ApiError(401, 'Сессия истекла — войди снова'));
    fireEvent.click(card('ussr_bt_5'));
    fireEvent.click(editPanel().getByRole('button', { name: '0.3' }));
    expect(await screen.findByText('Сессия истекла — войди снова')).toBeTruthy();
    expect(valueOn('ussr_bt_5')).toBe('1');
    expect(screen.queryByText('Режим правки')).toBeNull();
    expect(screen.getByRole('button', { name: 'Вход' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Правка значения' })).toBeNull();
  });
});

describe('выделение нескольких машин', () => {
  it('Ctrl/Shift-клик копит выбор, «Выбрано: N», одна правка на всех', async () => {
    await openAsEditor();
    fireEvent.click(card('ussr_t_26'));
    fireEvent.click(card('ussr_bt_5'), { ctrlKey: true });
    fireEvent.click(card('ussr_is_2_1944'), { shiftKey: true });
    expect(editPanel().getByText('Выбрано: 3')).toBeTruthy();
    fireEvent.click(editPanel().getByRole('button', { name: '✕ Блок' }));
    expect(sendEdit).toHaveBeenCalledTimes(1);
    expect(sendEdit.mock.calls[0][0]).toEqual([
      { ids: expect.arrayContaining(['ussr_t_26', 'ussr_bt_5', 'ussr_is_2_1944']), to: { b: true } },
    ]);
    await waitFor(() => expect(fake.state.changes).toHaveLength(1));
    expect(fake.state.changes[0].items).toHaveLength(3);
  });

  it('повторный Ctrl-клик снимает машину с выбора', async () => {
    await openAsEditor();
    fireEvent.click(card('ussr_t_26'));
    fireEvent.click(card('ussr_bt_5'), { ctrlKey: true });
    fireEvent.click(card('ussr_bt_5'), { ctrlKey: true });
    expect(card('ussr_bt_5').className).not.toMatch(/\bis-selected\b/);
    expect(card('ussr_t_26').className).toMatch(/\bis-selected\b/);
  });

  it('переключатель «Выделение» (телефон) — обычные клики копят выбор', async () => {
    await openAsEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Выделение' }));
    fireEvent.click(card('ussr_t_26'));
    fireEvent.click(card('ussr_bt_5'));
    expect(editPanel().getByText('Выбрано: 2')).toBeTruthy();
  });
});

describe('отмена из истории', () => {
  const change: Change = {
    seq: 4,
    at: new Date().toISOString(),
    kind: 'edit',
    items: [{ id: 'ussr_t_26', from: { c: 1 }, to: { c: 0.5 } }],
  };

  it('у зрителя кнопки «Отменить» нет', async () => {
    fake.state = { version: 4, values: { ussr_t_26: { c: 0.5 } }, changes: [change] };
    await openPage('#ussr');
    await screen.findByText(/Т-26 · 1 → 0.5/);
    expect(screen.queryByRole('button', { name: 'Отменить' })).toBeNull();
  });

  it('«Отменить» в режиме правки шлёт отмену этой записи и принимает ответ', async () => {
    fake.me = { editor: true, editingEnabled: true };
    fake.state = { version: 4, values: { ussr_t_26: { c: 0.5 } }, changes: [change] };
    await openPage('#ussr');
    await screen.findByText(/Т-26 · 1 → 0.5/);
    sendUndo.mockImplementationOnce(async () => {
      fake.state = {
        version: 5,
        values: {},
        changes: [
          { seq: 5, at: new Date().toISOString(), kind: 'undo', undoOf: 4, items: [{ id: 'ussr_t_26', from: { c: 0.5 }, to: { c: 1 } }] },
          change,
        ],
      };
      return structuredClone(fake.state);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Отменить' }));
    expect(sendUndo).toHaveBeenCalledWith(4);
    await waitFor(() => expect(valueOn('ussr_t_26')).toBe('1'));
    // Отдельной строки «отмена» нет: отменённая правка зачёркнута, кнопки у неё больше нет.
    expect(screen.getByText('отменено').closest('li')!.classList.contains('is-undone')).toBe(true);
    expect(document.querySelectorAll('.changes-list li')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Отменить' })).toBeNull();
  });

  it('«Отменить» не показан, если машину после этой записи уже меняли', async () => {
    fake.me = { editor: true, editingEnabled: true };
    const later = { seq: 5, at: new Date().toISOString(), kind: 'edit' as const, items: [{ id: 'ussr_t_26', from: { c: 0.5 }, to: { c: 0.8 } }] };
    fake.state = { version: 5, values: { ussr_t_26: { c: 0.8 } }, changes: [later, change] };
    await openPage('#ussr');
    await screen.findByText(/Т-26 · 0.5 → 0.8/);
    expect(screen.getAllByRole('button', { name: 'Отменить' })).toHaveLength(1);
  });
});

describe('файл значений', () => {
  function chooseFile(text: string) {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([text], 'values.json', { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
  }

  it('«Скачать значения» отдаёт wt-values-ГГГГ-ММ-ДД.json', async () => {
    await openAsEditor({ ussr_t_26: { c: 0.5 } });
    const urls: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => {
      urls.push(b);
      return 'blob:x';
    });
    URL.revokeObjectURL = vi.fn();
    let downloaded = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloaded = this.download;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Скачать значения' }));
    expect(downloaded).toMatch(/^wt-values-\d{4}-\d{2}-\d{2}\.json$/);
    const body = JSON.parse(await urls[0].text()) as { values: Record<string, unknown> };
    expect(body.values.ussr_t_26).toEqual({ c: 0.5 });
    expect(body.values.ussr_bt_5).toEqual({ c: 1 });
    click.mockRestore();
  });

  it('«Загрузить» — превью «изменится N машин», подтверждение — одна правка импорта', async () => {
    await openAsEditor({ ussr_t_26: { c: 0.5 } });
    chooseFile(JSON.stringify({ values: { ussr_t_26: { c: 0.5 }, ussr_bt_5: { b: true }, ussr_is_2_1944: { c: 0.2 } } }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Загрузить значения' }));
    expect(dialog.getByText('Изменится 2 машины')).toBeTruthy();
    expect(sendEdit).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole('button', { name: 'Применить' }));
    await waitFor(() => expect(sendEdit).toHaveBeenCalledTimes(1));
    expect(sendEdit.mock.calls[0][1]).toBe('import');
    await waitFor(() => expect(valueOn('ussr_bt_5')).toBe('✕'));
    expect(valueOn('ussr_is_2_1944')).toBe('0.2');
    expect(fake.state.changes).toHaveLength(1);
  });

  it('битый файл — «Файл не похож на значения сайта», ничего не меняется', async () => {
    await openAsEditor();
    chooseFile('{"hello": "world"}');
    expect(await screen.findByText('Файл не похож на значения сайта')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Загрузить значения' })).toBeNull();
    expect(sendEdit).not.toHaveBeenCalled();
  });
});
