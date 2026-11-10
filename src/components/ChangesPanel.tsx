/** «Последние изменения»: боковая панель (на узком экране — выезжающая). */
import type { Change } from '../../shared/types';
import { formatValue, sameValue, undoneSeqs } from '../../shared/values';
import { vehiclesCount, whenShort } from '../format';
import { catalog, changes, changesOpen, editor, now, openVehicle } from '../state';

const KIND_LABEL: Record<Change['kind'], string | null> = { edit: null, undo: null, import: 'файл' };

export function changeLabel(change: Change, names: (id: string) => string): string {
  const items = change.items;
  if (items.length === 1) {
    const it = items[0];
    return `${names(it.id)} · ${formatValue(it.from)} → ${formatValue(it.to)}`;
  }
  const to = items[0]?.to;
  const same = to !== undefined && items.every((it) => sameValue(it.to, to));
  return same ? `${vehiclesCount(items.length)} → ${formatValue(to)}` : `${vehiclesCount(items.length)} изменено`;
}

export function ChangesPanel() {
  // Запись отмены своей строкой не показываем — вместо неё зачёркнута отменённая правка.
  const list = changes.value.filter((ch) => ch.kind !== 'undo');
  const undone = undoneSeqs(changes.value);
  const cat = catalog.value;
  const at = now.value;
  const Actions = editor.value?.ChangeActions;
  const names = (id: string) => cat?.vehicles[id]?.name ?? id;
  return (
    <aside class={changesOpen.value ? 'changes is-open' : 'changes'} aria-label="Последние изменения">
      <div class="changes-head">
        <h2>Последние изменения</h2>
        <button type="button" class="changes-close" aria-label="Закрыть" onClick={() => (changesOpen.value = false)}>
          ✕
        </button>
      </div>
      {list.length === 0 ? (
        <p class="changes-empty">Пока без изменений</p>
      ) : (
        <ol class="changes-list">
          {list.map((ch) => {
            const kind = KIND_LABEL[ch.kind];
            const first = ch.items[0]?.id;
            const isUndone = undone.has(ch.seq);
            return (
              <li key={ch.seq} class={isUndone ? 'change is-undone' : 'change'}>
                {kind && <span class={`change-kind change-kind--${ch.kind}`}>{kind}</span>}
                <button
                  type="button"
                  class="change-main"
                  title={ch.items.length > 1 ? ch.items.map((it) => names(it.id)).join(', ') : undefined}
                  onClick={() => {
                    if (first) openVehicle(first);
                    changesOpen.value = false;
                  }}
                >
                  {`${changeLabel(ch, names)} · ${whenShort(ch.at, at)}`}
                </button>
                {isUndone ? <span class="change-undone">отменено</span> : Actions && <Actions change={ch} />}
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
