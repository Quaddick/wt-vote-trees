import { catalog, nation, selectNation } from '../state';
import { flagUrl } from '../format';

export function NationTabs() {
  const cat = catalog.value;
  if (!cat) return null;
  return (
    <nav class="tabs" role="tablist" aria-label="Нации">
      {cat.nations.map((n) => {
        const active = n.code === nation.value;
        return (
          <button
            key={n.code}
            type="button"
            role="tab"
            aria-selected={active}
            class={active ? 'tab is-active' : 'tab'}
            onClick={() => selectNation(n.code)}
          >
            <img class="tab-flag" src={flagUrl(n.flag)} alt="" width={24} height={16} />
            <span>{n.nameRu}</span>
          </button>
        );
      })}
    </nav>
  );
}
