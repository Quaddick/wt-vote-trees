/** Всплывающие подробности машины (клик по карточке вне режима правки). */
import { useEffect, useRef } from 'preact/hooks';
import { formatValue, valueOf } from '../../shared/values';
import { CLASS_LABEL, formatBr, roman, whenShort } from '../format';
import { catalog, closeDetails, details, lastChangeOf, now, values } from '../state';
import { SlotIcon } from './VehicleCard';

export function DetailsPopup() {
  const id = details.value;
  const v = id ? catalog.value?.vehicles[id] : undefined;
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!v) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDetails();
    };
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [v]);

  if (!id || !v) return null;
  const value = valueOf(values.value, id);
  const blocked = 'b' in value;
  const last = lastChangeOf(id);
  const nationName = catalog.value?.nations.find((n) => n.code === v.nation)?.nameRu ?? v.nation;
  const titleId = 'details-title';
  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && closeDetails()}>
      <div class={`details details--${v.cls}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <button ref={closeRef} type="button" class="details-close" aria-label="Закрыть" onClick={closeDetails}>
          ✕
        </button>
        <div class="details-top">
          <span class="details-icon">
            <SlotIcon id={id} hasSlot={v.hasSlot} />
          </span>
          <div>
            <h2 id={titleId} class="details-name">
              {v.nameRu}
            </h2>
            {v.nameEn !== v.nameRu && <p class="details-alt">{v.nameEn}</p>}
          </div>
          <span
            class={blocked ? 'details-value details-value--block' : 'details-value'}
            data-testid="details-value"
            title={blocked ? 'Техника недоступна' : 'Коэффициент'}
          >
            {formatValue(value)}
          </span>
        </div>
        <dl class="details-facts">
          <dt>Нация</dt>
          <dd>{nationName}</dd>
          <dt>Ранг</dt>
          <dd>Ранг {roman(v.rank)}</dd>
          <dt>Боевой рейтинг</dt>
          <dd>{v.br ? `АБ ${formatBr(v.br.ab)} · РБ ${formatBr(v.br.rb)} · СБ ${formatBr(v.br.sb)}` : 'БР —'}</dd>
          <dt>Тип</dt>
          <dd>{CLASS_LABEL[v.cls]}</dd>
          <dt>Значение</dt>
          <dd>{blocked ? 'Техника недоступна' : `Коэффициент ${formatValue(value)}`}</dd>
          <dt>Последняя правка</dt>
          <dd data-testid="details-last">
            {last
              ? `${formatValue(last.from)} → ${formatValue(last.to)} · ${whenShort(last.change.at, now.value)}`
              : 'Правок не было'}
          </dd>
        </dl>
      </div>
    </div>
  );
}
