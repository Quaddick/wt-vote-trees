/** Вид «Список»: машины нации по рангам, строка — иконка, имя, БР, значение. */
import { brRb, roman } from '../format';
import { cardClick, catalog, currentTree, nationRanks } from '../state';
import { SlotIcon, ValueMark, useVehicleView } from './VehicleCard';
import { formatValue } from '../../shared/values';

function ListRow({ id }: { id: string }) {
  const v = catalog.value?.vehicles[id];
  const { text, blocked, was, saving, classes } = useVehicleView(id);
  if (!v) return null;
  return (
    <li>
      <button
        type="button"
        class={['row', `row--${v.cls}`, ...classes].join(' ')}
        data-vid={id}
        data-value={text}
        onClick={(e) => cardClick(id, e)}
      >
        <span class="row-icon">
          <SlotIcon id={id} hasSlot={v.hasSlot} />
        </span>
        <span class="row-name">
          {v.name}
          {v.cls !== 'research' && <span class="row-tag">{v.cls === 'squad' ? 'отряд' : 'премиум'}</span>}
          {saving && <span class="row-saving">сохраняю…</span>}
          {was && !saving && <span class="row-was">было {formatValue(was)}</span>}
        </span>
        <span class="row-br">{brRb(v.br)}</span>
        <span class="row-value">
          <ValueMark text={text} blocked={blocked} />
        </span>
      </button>
    </li>
  );
}

export function ListView() {
  const tree = currentTree.value;
  if (!tree) return null;
  return (
    <div class="list">
      {nationRanks(tree).map((r) => (
        <section key={r.rank} class="list-rank" aria-label={`Ранг ${roman(r.rank)}`}>
          <h3 class="list-rank-title">Ранг {roman(r.rank)}</h3>
          <ul class="list-rows">
            {[...r.research, ...r.premium].map((id) => (
              <ListRow key={id} id={id} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
