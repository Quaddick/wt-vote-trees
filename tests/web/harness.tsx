/** Запуск страницы целиком в jsdom: состояние + App поверх подменённого `src/api.ts`. */
import { cleanup, render, screen } from '@testing-library/preact';
import { App } from '../../src/App';
import { start } from '../../src/state';

let stop: (() => void) | null = null;

/** Открыть страницу с данным хэшем; ждёт, пока нарисуются вкладки наций. */
export async function openPage(hash = ''): Promise<void> {
  history.replaceState(null, '', hash ? `/${hash}` : '/');
  stop = start();
  render(<App />);
  await screen.findAllByRole('tab');
}

export function closePage(): void {
  stop?.();
  stop = null;
  cleanup();
}

/** Карточка машины в дереве или строка в списке. */
export function card(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-vid="${id}"]`);
  if (!el) throw new Error(`нет карточки ${id}`);
  return el;
}
