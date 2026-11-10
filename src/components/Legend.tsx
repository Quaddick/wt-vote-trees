/** Легенда как на скриншотах + фильтр: чипы значений нации с числом машин. */
import { vehiclesCount } from '../format';
import { toggleFilter, valueChips, valueFilter } from '../state';

export function Legend() {
  const chips = valueChips.value;
  const active = valueFilter.value;
  return (
    <section class="legend" role="region" aria-label="Легенда">
      <ul class="legend-keys">
        <li>
          <span class="legend-mark legend-mark--one" aria-hidden="true">1</span> <span>— обычный коэффициент</span>
        </li>
        <li>
          <span>меньше 1 — пониженный коэффициент</span>
        </li>
        <li>
          <span class="legend-mark legend-mark--cross" aria-hidden="true">✕</span> <span>— техника недоступна</span>
        </li>
      </ul>
      {chips.length > 0 && (
        <div class="legend-chips">
          <span class="legend-hint">Показать только:</span>
          {chips.map((chip) => {
            const pressed = active === chip.key;
            return (
              <button
                key={chip.key}
                type="button"
                class={['chip', 'b' in chip.value ? 'chip--block' : '', pressed ? 'is-active' : ''].join(' ').trim()}
                aria-pressed={pressed}
                aria-label={`${chip.key} — ${vehiclesCount(chip.count)}`}
                title={pressed ? 'Снять фильтр' : `Показать только «${chip.key}»`}
                onClick={() => toggleFilter(chip.key)}
              >
                <span class="chip-value">{chip.key}</span>
                <span class="chip-count">{chip.count}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
