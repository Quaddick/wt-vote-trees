/**
 * Карточка машины: слот, имя, БР РБ, крупная жёлтая цифра или красный крест.
 * Состояния: приглушена фильтром, блок, недавно изменена («было …»), выделена, сохраняется, вспышка.
 */
import { formatValue, valueOf } from '../../shared/values';
import { brRb, slotUrl } from '../format';
import { cardClick, catalog, flash, pending, recent, selection, valueFilter, values } from '../state';

export function SlotIcon({ id, hasSlot }: { id: string; hasSlot: boolean }) {
  return hasSlot ? (
    <img class="card-img" src={slotUrl(id)} alt="" loading="lazy" decoding="async" draggable={false} />
  ) : (
    <span class="card-noicon" aria-hidden="true">
      нет иконки
    </span>
  );
}

/** Общее для карточки и строки списка: значение и классы состояния. */
export function useVehicleView(id: string) {
  const saving = pending.value.get(id);
  const value = saving ?? valueOf(values.value, id);
  const text = formatValue(value);
  const blocked = 'b' in value;
  const was = recent.value.get(id);
  const filter = valueFilter.value;
  const classes = [
    blocked && 'is-blocked',
    filter !== null && filter !== text && 'is-filtered-out',
    was && 'is-recent',
    selection.value.has(id) && 'is-selected',
    saving && 'is-saving',
    flash.value?.id === id && 'is-flash',
  ].filter(Boolean);
  return { value, text, blocked, was, saving: saving !== undefined, classes };
}

export function ValueMark({ text, blocked }: { text: string; blocked: boolean }) {
  return blocked ? (
    <span class="card-cross" title="Техника недоступна">
      {text}
    </span>
  ) : (
    <span class="card-value" title="Коэффициент">
      {text}
    </span>
  );
}

export function VehicleCard({ id }: { id: string }) {
  const v = catalog.value?.vehicles[id];
  const state = useVehicleView(id);
  if (!v) return null;
  const { text, blocked, was, saving, classes } = state;
  return (
    <button
      type="button"
      class={['card', `card--${v.cls}`, ...classes].join(' ')}
      data-vid={id}
      data-value={text}
      title={v.nameEn !== v.name ? `${v.name} (${v.nameEn})` : v.name}
      onClick={(e) => cardClick(id, e)}
    >
      <span class="card-icon">
        <SlotIcon id={id} hasSlot={v.hasSlot} />
      </span>
      <span class="card-name">{v.name}</span>
      <span class="card-br">{brRb(v.br)}</span>
      <ValueMark text={text} blocked={blocked} />
      {saving && <span class="card-saving">сохраняю…</span>}
      {was && !saving && <span class="card-was">было {formatValue(was)}</span>}
    </button>
  );
}
