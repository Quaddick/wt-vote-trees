/** Режим правки: кнопки в шапке, панель значения, окна входа и загрузки, тост, «Отменить». */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Change } from '../../shared/types';
import { PRESETS, formatValue, parseCoefficient, sameValue, undoableItems, valueOf } from '../../shared/values';
import { brRb, vehiclesCount } from '../format';
import { catalog, editMode, editingEnabled, pending, selection, values } from '../state';
import {
  applyValue,
  busy,
  cancelImport,
  clearSelection,
  closeLogin,
  confirmImport,
  downloadValues,
  hideToast,
  importPreview,
  loginOpen,
  logoutNow,
  openLogin,
  previewImport,
  selectMode,
  submitLogin,
  toast,
  toggleSelectMode,
  undoChange,
} from './model';

// ── шапка ───────────────────────────────────────────────────────────────
export function Toolbar() {
  const fileRef = useRef<HTMLInputElement>(null);
  if (!editMode.value) {
    return editingEnabled.value ? (
      <button type="button" class="ed-btn ed-login" onClick={openLogin}>
        Вход
      </button>
    ) : null;
  }
  const count = selection.value.size;
  return (
    <div class="ed-bar" role="group" aria-label="Режим правки">
      <span class="ed-badge">Режим правки</span>
      <button
        type="button"
        class="ed-btn"
        aria-pressed={selectMode.value}
        title="Обычный клик добавляет машину к выбору (на компьютере — Ctrl или Shift)"
        onClick={toggleSelectMode}
      >
        Выделение
      </button>
      {count > 1 && <span class="ed-count">Выбрано: {count}</span>}
      {/* ed-wide — на телефоне спрятаны, те же действия в меню «⋯» */}
      <button type="button" class="ed-btn ed-wide" onClick={() => downloadValues()}>
        Скачать значения
      </button>
      <button type="button" class="ed-btn ed-wide" onClick={() => fileRef.current?.click()}>
        Загрузить
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const input = e.currentTarget;
          const file = input.files?.[0];
          if (file) void previewImport(file);
          input.value = '';
        }}
      />
      <button type="button" class="ed-btn ed-wide" onClick={() => void logoutNow()}>
        Выйти
      </button>
      <MoreMenu onUpload={() => fileRef.current?.click()} />
    </div>
  );
}

/** Меню «⋯» для телефона: редкие действия стримера, чтобы шапка правки была в одну строку. */
function MoreMenu({ onUpload }: { onUpload: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  return (
    <div class="ed-more" ref={ref}>
      <button
        type="button"
        class="ed-btn"
        aria-label="Ещё"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        ⋯
      </button>
      {open && (
        <div class="ed-menu" role="menu">
          <button type="button" role="menuitem" class="ed-menu-item" onClick={run(() => downloadValues())}>
            Скачать значения
          </button>
          <button type="button" role="menuitem" class="ed-menu-item" onClick={run(onUpload)}>
            Загрузить
          </button>
          <button type="button" role="menuitem" class="ed-menu-item" onClick={run(() => void logoutNow())}>
            Выйти
          </button>
        </div>
      )}
    </div>
  );
}

// ── «Отменить» у строки истории ─────────────────────────────────────────
export function ChangeActions({ change }: { change: Change }) {
  if (!editMode.value) return null;
  // Все машины записи после неё меняли ещё раз — отменять нечего.
  if (undoableItems(change, values.value).length === 0) return null;
  return (
    <button
      type="button"
      class="ed-undo"
      disabled={busy.value}
      title="Вернуть значения, что были до этой записи"
      onClick={() => void undoChange(change)}
    >
      Отменить
    </button>
  );
}

// ── окно входа ──────────────────────────────────────────────────────────
function LoginDialog() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);
  useEffect(() => fieldRef.current?.focus(), []);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    const err = await submitLogin(password);
    setSending(false);
    setError(err);
    if (err) fieldRef.current?.focus();
  };

  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && closeLogin()}>
      <div class="ed-dialog" role="dialog" aria-modal="true" aria-label="Вход">
        <form onSubmit={submit}>
          <h2 class="ed-dialog-title">Вход для стримера</h2>
          <label class="ed-field">
            <span>Пароль</span>
            <input
              ref={fieldRef}
              type="password"
              autocomplete="current-password"
              value={password}
              aria-invalid={error !== null}
              aria-describedby={error ? 'ed-login-error' : undefined}
              onInput={(e) => setPassword(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Escape' && closeLogin()}
            />
          </label>
          {error && (
            <p id="ed-login-error" class="ed-error" role="alert">
              {error}
            </p>
          )}
          <div class="ed-actions">
            <button type="button" class="ed-btn" onClick={closeLogin}>
              Отмена
            </button>
            <button type="submit" class="ed-btn ed-btn--primary" disabled={sending || password === ''}>
              Войти
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── панель значения ─────────────────────────────────────────────────────
function EditSheet() {
  const ids = [...selection.value];
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearSelection();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const cat = catalog.value;
  const shown = (id: string) => pending.value.get(id) ?? valueOf(values.value, id);
  const single = ids.length === 1 ? cat?.vehicles[ids[0]] : undefined;
  const current = ids.length > 0 && ids.every((id) => sameValue(shown(id), shown(ids[0]))) ? shown(ids[0]) : null;

  const submitCustom = (e: Event) => {
    e.preventDefault();
    const parsed = parseCoefficient(custom);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    void applyValue(parsed.value);
  };

  return (
    <section class="ed-sheet" role="region" aria-label="Правка значения">
      <div class="ed-sheet-head">
        {single ? (
          <span class="ed-sheet-title">
            {single.name} <span class="ed-sheet-br">{brRb(single.br)}</span>
          </span>
        ) : (
          <span class="ed-sheet-title">Выбрано: {ids.length}</span>
        )}
        {current && <span class="ed-sheet-now">сейчас {formatValue(current)}</span>}
        <button type="button" class="ed-sheet-close" aria-label="Снять выделение" onClick={clearSelection}>
          ✕
        </button>
      </div>
      <div class="ed-presets" role="group" aria-label="Значение">
        {PRESETS.map((p) => {
          const block = 'b' in p;
          const label = block ? '✕ Блок' : formatValue(p);
          return (
            <button
              key={label}
              type="button"
              class={block ? 'ed-preset ed-preset--block' : 'ed-preset'}
              aria-pressed={current !== null && sameValue(current, p)}
              onClick={() => void applyValue(p)}
            >
              {label}
            </button>
          );
        })}
      </div>
      <form class="ed-custom" onSubmit={submitCustom} noValidate>
        <input
          class="ed-custom-input"
          type="text"
          inputMode="decimal"
          placeholder="свой"
          aria-label="Свой коэффициент"
          aria-invalid={error !== null}
          aria-describedby={error ? 'ed-custom-error' : undefined}
          value={custom}
          onInput={(e) => {
            setCustom(e.currentTarget.value);
            if (error) setError(null);
          }}
        />
        <button type="submit" class="ed-btn">
          Применить
        </button>
        {error && (
          <p id="ed-custom-error" class="ed-error" role="alert">
            {error}
          </p>
        )}
      </form>
      {ids.length > 1 && <p class="ed-hint">Значение получат все выбранные машины — одной записью истории.</p>}
    </section>
  );
}

// ── окно загрузки ───────────────────────────────────────────────────────
function ImportDialog() {
  const preview = importPreview.value;
  const open = preview !== null;
  // layout — чтобы Escape работал сразу, как окно появилось
  useLayoutEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelImport();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  if (!preview) return null;
  const nothing = preview.count === 0;
  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && cancelImport()}>
      <div class="ed-dialog" role="dialog" aria-modal="true" aria-label="Загрузить значения">
        <h2 class="ed-dialog-title">Загрузить значения</h2>
        <p class="ed-file">{preview.fileName}</p>
        <p class="ed-summary">{nothing ? 'Ничего не изменится' : `Изменится ${vehiclesCount(preview.count)}`}</p>
        {!nothing && <p class="ed-hint">Правка ляжет в историю одной записью — её можно отменить.</p>}
        <div class="ed-actions">
          <button type="button" class="ed-btn" onClick={cancelImport}>
            Отмена
          </button>
          <button
            type="button"
            class="ed-btn ed-btn--primary"
            disabled={nothing || busy.value}
            onClick={() => void confirmImport()}
          >
            Применить
          </button>
        </div>
      </div>
    </div>
  );
}

function ToastView() {
  const t = toast.value;
  if (!t) return null;
  return (
    <div class={`ed-toast ed-toast--${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
      <span>{t.text}</span>
      <button type="button" class="ed-toast-close" aria-label="Скрыть" onClick={hideToast}>
        ✕
      </button>
    </div>
  );
}

/** Всё плавающее режима правки. Рисуется всегда, само решает, что показать. */
export function Panel() {
  return (
    <>
      {loginOpen.value && !editMode.value && <LoginDialog />}
      {editMode.value && selection.value.size > 0 && <EditSheet />}
      {editMode.value && <ImportDialog />}
      <ToastView />
    </>
  );
}
