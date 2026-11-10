/** Плашка «Нет связи с сервером»: показывается, пока опрос не удаётся; исчезает сама. */
import { hhmm } from '../format';
import { connection } from '../state';

export function ConnectionBanner() {
  const c = connection.value;
  if (c.online) return null;
  const text =
    c.lastSuccess === null
      ? 'Нет связи с сервером — значения ещё не загружены'
      : `Нет связи с сервером — значения на ${hhmm(c.lastSuccess)}`;
  return (
    <div class="banner" role="alert">
      {text}
    </div>
  );
}
