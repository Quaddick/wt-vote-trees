/**
 * Клиент страницы: единственное место, где страница ходит в сеть.
 * Адреса относительные — сайт может стоять и в корне, и в подпапке за nginx.
 */
import type { Edit, StateResponse, TreeCatalog } from '../shared/types';

/** Ошибка ответа API. `status` 0 — до сервера не достучались. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init });
  } catch {
    throw new ApiError(0, 'нет связи с сервером');
  }
}

async function errorOf(res: Response): Promise<ApiError> {
  let message = `ошибка сервера ${res.status}`;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error) message = body.error;
  } catch {
    // тело не JSON — остаётся код ответа
  }
  return new ApiError(res.status, message);
}

function postJson(path: string, body: unknown): Promise<Response> {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function fetchState(etag?: string): Promise<{ state: StateResponse; etag: string } | 'not-modified'> {
  const res = await request('api/state', { headers: etag ? { 'If-None-Match': etag } : {} });
  if (res.status === 304) return 'not-modified';
  if (!res.ok) throw await errorOf(res);
  const state = (await res.json()) as StateResponse;
  return { state, etag: res.headers.get('ETag') ?? `"${state.version}"` };
}

export async function fetchMe(): Promise<{ editor: boolean; editingEnabled: boolean }> {
  const res = await request('api/me');
  if (!res.ok) throw await errorOf(res);
  return (await res.json()) as { editor: boolean; editingEnabled: boolean };
}

/**
 * 403 на вход бывает по двум причинам: вход выключен (пароль не задан) или запрос с чужого Origin
 * (обычно nginx без `Host $host`). Причину берём из флага `editingEnabled` свежего `/api/me` — он не
 * проходит проверку Origin и не зависит от текста ошибки. «disabled» — только если сервер подтвердил,
 * что вход выключен; иначе ApiError 403 с текстом сервера.
 */
export async function login(password: string): Promise<'ok' | 'wrong' | 'too-many' | 'disabled'> {
  const res = await postJson('api/login', { password });
  if (res.ok) return 'ok';
  if (res.status === 401) return 'wrong';
  if (res.status === 429) return 'too-many';
  const error = await errorOf(res);
  if (res.status === 403 && (await loginDisabled())) return 'disabled';
  throw error;
}

async function loginDisabled(): Promise<boolean> {
  try {
    return (await fetchMe()).editingEnabled === false;
  } catch {
    return false;
  }
}

export async function logout(): Promise<void> {
  const res = await postJson('api/logout', {});
  if (!res.ok) throw await errorOf(res);
}

export async function sendEdit(edits: Edit[], kind?: 'edit' | 'import'): Promise<StateResponse> {
  const res = await postJson('api/edit', kind ? { edits, kind } : { edits });
  if (!res.ok) throw await errorOf(res);
  return (await res.json()) as StateResponse;
}

export async function sendUndo(seq: number): Promise<StateResponse> {
  const res = await postJson('api/undo', { seq });
  if (!res.ok) throw await errorOf(res);
  return (await res.json()) as StateResponse;
}

export async function loadCatalog(): Promise<TreeCatalog> {
  const res = await request('catalog/trees.json', { cache: 'default' });
  if (!res.ok) throw new ApiError(res.status, 'не удалось загрузить каталог деревьев');
  return (await res.json()) as TreeCatalog;
}
