/** Поиск машины по всем нациям (горячая клавиша «/»). */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { formatValue, valueOf } from '../../shared/values';
import { flagUrl, roman } from '../format';
import { catalog, openVehicle, searchVehicles, values } from '../state';

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function Search() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const results = useMemo(() => searchVehicles(query), [query, catalog.value]);
  const nations = new Map((catalog.value?.nations ?? []).map((n) => [n.code, n]));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const choose = (id: string) => {
    setQuery('');
    setOpen(false);
    setActive(0);
    inputRef.current?.blur();
    openVehicle(id);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const hit = results[active] ?? results[0];
      if (hit) choose(hit.id);
    } else if (e.key === 'Escape') {
      setQuery('');
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const showList = open && query.trim() !== '';
  return (
    <div class="search">
      <input
        ref={inputRef}
        class="search-input"
        type="search"
        aria-label="Поиск машины"
        placeholder="Поиск машины"
        title="Поиск по всем нациям — клавиша /"
        autocomplete="off"
        spellcheck={false}
        value={query}
        aria-controls="search-results"
        onInput={(e) => {
          setQuery(e.currentTarget.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <ul
          id="search-results"
          class="search-results"
          role="listbox"
          aria-label="Найденные машины"
          onMouseDown={(e) => e.preventDefault()}
        >
          {results.length === 0 ? (
            <li class="search-empty">Ничего не нашлось</li>
          ) : (
            results.map((v, i) => {
              const n = nations.get(v.nation);
              return (
                <li
                  key={v.id}
                  role="option"
                  aria-selected={i === active}
                  class={i === active ? 'search-hit is-active' : 'search-hit'}
                  data-result={v.id}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(v.id)}
                >
                  {n && <img class="search-flag" src={flagUrl(n.flag)} alt="" width={20} height={13} />}
                  <span class="search-name">
                    {v.name}
                    {v.nameEn !== v.name && <span class="search-alt"> · {v.nameEn}</span>}
                  </span>
                  <span class="search-meta">
                    {n?.nameRu} · {roman(v.rank)}
                  </span>
                  <span class="search-value">{formatValue(valueOf(values.value, v.id))}</span>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
