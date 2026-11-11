/** Мелкое форматирование для страницы. */
import type { BattleRating, VehicleClass } from '../shared/types';

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

export function roman(n: number): string {
  return ROMAN[n] ?? String(n);
}

/** БР с одним знаком: 6.3, 10.0. Нет БР — «—». */
export function formatBr(br: number | undefined | null): string {
  return typeof br === 'number' ? br.toFixed(1) : '—';
}

export function brRb(br: BattleRating | null): string {
  return formatBr(br?.rb);
}

/**
 * Размер названия на карточке. Название всегда в одну строку: вторая строка уходит под цифру
 * коэффициента, она стоит по центру карточки. Пороги — по ширине самых широких названий каталога
 * (жирный 12 px): до 13 символов влезает в колонку справа от иконки, 14–17 — при 11 px,
 * длиннее — 10 px и заходит на верх иконки (самое длинное, 26 символов, — 139 px из 155).
 */
export function nameSize(name: string): 'm' | 's' | 'xs' {
  const n = [...name].length;
  return n <= 13 ? 'm' : n <= 17 ? 's' : 'xs';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** «ЧЧ:ММ» по местному времени. */
export function hhmm(time: number | string): string {
  const d = new Date(time);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** «ЧЧ:ММ» для сегодняшнего, «ДД.ММ ЧЧ:ММ» для более раннего. */
export function whenShort(time: string, now: number): string {
  const d = new Date(time);
  const today = new Date(now);
  const sameDay =
    d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  return sameDay ? hhmm(d.getTime()) : `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${hhmm(d.getTime())}`;
}

/** 1 машина, 2 машины, 5 машин. */
export function vehiclesCount(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? 'машина'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? 'машины'
        : 'машин';
  return `${n} ${word}`;
}

export const CLASS_LABEL: Record<VehicleClass, string> = {
  research: 'Исследуемая',
  premium: 'Премиумная',
  squad: 'Отрядная',
};

export function slotUrl(id: string): string {
  return `catalog/slots/${id}.webp`;
}

export function flagUrl(flag: string): string {
  return `catalog/${flag}`;
}
