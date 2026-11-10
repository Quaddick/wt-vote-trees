/**
 * Страница зрителя. Слоты режима правки (таск 04) — из `editor` в `state.ts`:
 * `Toolbar` — в шапке, `Panel` — после основной области (сама позиционируется),
 * `ChangeActions` — у строк «Последних изменений».
 */
import { useSignalEffect } from '@preact/signals';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { catalog, catalogError, changesOpen, editor, flash, recent, setView, view } from './state';
import { ChangesPanel } from './components/ChangesPanel';
import { ConnectionBanner } from './components/ConnectionBanner';
import { DetailsPopup } from './components/DetailsPopup';
import { Legend } from './components/Legend';
import { ListView } from './components/ListView';
import { NationTabs } from './components/NationTabs';
import { Search } from './components/Search';
import { TreeView } from './components/TreeView';

/** Прокрутка к машине, к которой перешли (поиск, ссылка, «Последние изменения»). */
function FlashScroller() {
  useSignalEffect(() => {
    const f = flash.value;
    if (!f) return;
    // после перерисовки: вкладка или вид могли смениться в том же действии
    const t = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-vid="${f.id}"]`);
      el?.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'smooth' });
    }, 0);
    return () => clearTimeout(t);
  });
  return null;
}

function ViewToggle() {
  const mode = view.value;
  return (
    <div class="seg" role="group" aria-label="Вид">
      <button type="button" class="seg-btn" aria-pressed={mode === 'tree'} onClick={() => setView('tree')}>
        Дерево
      </button>
      <button type="button" class="seg-btn" aria-pressed={mode === 'list'} onClick={() => setView('list')}>
        Список
      </button>
    </div>
  );
}

/** Кнопка выезжающей панели «Последние изменения» (видна на узком экране). */
function ChangesToggle() {
  const fresh = recent.value.size;
  return (
    <button
      type="button"
      class="changes-toggle"
      aria-expanded={changesOpen.value}
      onClick={() => (changesOpen.value = !changesOpen.value)}
    >
      Изменения{fresh > 0 && <span class="changes-toggle-count">{fresh}</span>}
    </button>
  );
}

/** Высота закреплённой шапки → `--header-h` (под ней липнет панель изменений). */
function useHeaderHeight() {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return ref;
}

export function App() {
  const Editor = editor.value;
  const headerRef = useHeaderHeight();
  return (
    <div class="app">
      <header class="top" ref={headerRef}>
        <div class="top-row">
          <h1 class="brand">
            <span class="brand-main">Деревья техники</span>
            <span class="brand-sub">коэффициенты голосовалки</span>
          </h1>
          <Search />
          <ViewToggle />
          <ChangesToggle />
          {Editor?.Toolbar && <Editor.Toolbar />}
        </div>
        <NationTabs />
        {catalog.value && <Legend />}
        <ConnectionBanner />
      </header>
      <div class="layout">
        <main class="main">
          {catalogError.value ? (
            <p class="notice notice--error">{catalogError.value}</p>
          ) : !catalog.value ? (
            <p class="notice">Загружаю деревья…</p>
          ) : view.value === 'tree' ? (
            <TreeView />
          ) : (
            <ListView />
          )}
        </main>
        <ChangesPanel />
        {changesOpen.value && <div class="changes-backdrop" onClick={() => (changesOpen.value = false)} />}
      </div>
      {Editor?.Panel && <Editor.Panel />}
      <DetailsPopup />
      <FlashScroller />
    </div>
  );
}
