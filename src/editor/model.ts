/**
 * Режим правки: вход, выбор машин, применение значения, отмена, файл значений.
 * Общее состояние страницы — в `../state`; здесь только то, что нужно редактору.
 */
import { batch, signal } from '@preact/signals';
import type { Change, Edit, StateResponse, Value, ValueMap } from '../../shared/types';
import { sameValue, valueOf } from '../../shared/values';
import * as api from '../api';
import { acceptState, catalog, editMode, pending, selection, values } from '../state';
import { vehiclesCount } from '../format';
import { exportFileName, importEdits, parseValuesFile, serializeValues } from './values-file';

export const SESSION_EXPIRED = 'Сессия истекла — войди снова';
export const NOT_VALUES_FILE = 'Файл не похож на значения сайта';
const TOAST_MS = 6000;

export interface Toast {
  text: string;
  kind: 'error' | 'info';
  seq: number;
}

/** Окно входа открыто. */
export const loginOpen = signal(false);
/** Переключатель «Выделение»: обычный клик копит выбор (для телефона). */
export const selectMode = signal(false);
export const toast = signal<Toast | null>(null);
/** Превью загрузки файла: что изменится. */
export const importPreview = signal<{ fileName: string; edits: Edit[]; count: number } | null>(null);
/** Идёт запрос, после которого нельзя жать ещё раз (отмена, импорт). */
export const busy = signal(false);

let toastSeq = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function showToast(text: string, kind: Toast['kind'] = 'error'): void {
  const seq = ++toastSeq;
  toast.value = { text, kind, seq };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (toast.value?.seq === seq) toast.value = null;
  }, TOAST_MS);
}

export function hideToast(): void {
  toast.value = null;
}

function statusOf(e: unknown): number {
  return e instanceof api.ApiError ? e.status : -1;
}

function reasonOf(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'неизвестная ошибка';
}

function leaveEditMode(): void {
  batch(() => {
    editMode.value = false;
    selection.value = new Set();
    selectMode.value = false;
    importPreview.value = null;
  });
}

/** Ошибка изменяющего запроса: 401 — выход из режима правки, иначе тост с причиной. */
function reportFailure(e: unknown): void {
  if (statusOf(e) === 401) {
    leaveEditMode();
    showToast(SESSION_EXPIRED);
  } else {
    showToast(`Не сохранилось: ${reasonOf(e)}. Попробуй ещё раз`);
  }
}

// ── вход ────────────────────────────────────────────────────────────────
export function openLogin(): void {
  loginOpen.value = true;
}

export function closeLogin(): void {
  loginOpen.value = false;
}

const LOGIN_ERRORS = {
  wrong: 'Неверный пароль',
  'too-many': 'Слишком много попыток, подожди 10 минут',
  disabled: 'Вход выключен: на сервере не задан пароль',
} as const;

/** Возвращает текст ошибки или null при успехе. */
export async function submitLogin(password: string): Promise<string | null> {
  let result: Awaited<ReturnType<typeof api.login>>;
  try {
    result = await api.login(password);
  } catch (e) {
    return statusOf(e) === 0 ? 'Нет связи с сервером' : `Не получилось войти: ${reasonOf(e)}`;
  }
  if (result !== 'ok') return LOGIN_ERRORS[result];
  batch(() => {
    loginOpen.value = false;
    editMode.value = true;
  });
  return null;
}

export async function logoutNow(): Promise<void> {
  try {
    await api.logout();
  } catch {
    // cookie на сервере останется, но страница всё равно выходит из режима правки
  }
  leaveEditMode();
}

// ── выбор ───────────────────────────────────────────────────────────────
/** Клик по карточке в режиме правки: Ctrl/Shift/«Выделение» — копить выбор, иначе выбрать одну. */
export function onCardClick(id: string, event: MouseEvent): void {
  const accumulate = event.ctrlKey || event.metaKey || event.shiftKey || selectMode.value;
  if (!accumulate) {
    selection.value = new Set([id]);
    return;
  }
  const next = new Set(selection.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selection.value = next;
}

export function clearSelection(): void {
  selection.value = new Set();
}

export function toggleSelectMode(): void {
  selectMode.value = !selectMode.value;
}

// ── правка ──────────────────────────────────────────────────────────────
function setPending(ids: string[], to: Value | null, only?: Value): void {
  const next = new Map(pending.value);
  for (const id of ids) {
    if (to) next.set(id, to);
    else if (only === undefined || next.get(id) === only) next.delete(id);
  }
  pending.value = next;
}

/** Поставить выбранным машинам значение: сразу на карточке («сохраняю…»), откат при ошибке. */
export async function applyValue(value: Value): Promise<void> {
  const ids = [...selection.value];
  const to: Value = { ...value };
  const shown = (id: string) => pending.value.get(id) ?? valueOf(values.value, id);
  if (ids.length === 0 || ids.every((id) => sameValue(shown(id), to))) return;
  setPending(ids, to);
  try {
    acceptState(await api.sendEdit([{ ids, to }]));
  } catch (e) {
    reportFailure(e);
  } finally {
    setPending(ids, null, to);
  }
}

export async function undoChange(change: Change): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    acceptState(await api.sendUndo(change.seq));
  } catch (e) {
    reportFailure(e);
  } finally {
    busy.value = false;
  }
}

// ── файл значений ───────────────────────────────────────────────────────
export function downloadValues(now = new Date()): void {
  const ids = Object.keys(catalog.value?.vehicles ?? {});
  const text = serializeValues(values.value, ids, now);
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFileName(now);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Прочитать выбранный файл и показать превью; битый файл — тост, ничего не меняется. */
export async function previewImport(file: File): Promise<void> {
  let parsed: ValueMap | null = null;
  try {
    parsed = parseValuesFile(await file.text());
  } catch {
    parsed = null;
  }
  if (!parsed) {
    importPreview.value = null;
    showToast(NOT_VALUES_FILE);
    return;
  }
  const { edits, count } = importEdits(values.value, parsed);
  importPreview.value = { fileName: file.name, edits, count };
}

export function cancelImport(): void {
  importPreview.value = null;
}

export async function confirmImport(): Promise<void> {
  const preview = importPreview.value;
  if (!preview || preview.count === 0 || busy.value) return;
  busy.value = true;
  try {
    const state: StateResponse = await api.sendEdit(preview.edits, 'import');
    acceptState(state);
    importPreview.value = null;
    showToast(`Загружено: ${vehiclesCount(preview.count)}`, 'info');
  } catch (e) {
    importPreview.value = null;
    reportFailure(e);
  } finally {
    busy.value = false;
  }
}
