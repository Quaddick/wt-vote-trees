/** Общий контракт данных сервера, страницы и скриптов. Менять только через спецификацию. */

export type NationCode = 'us' | 'germ' | 'ussr' | 'uk' | 'jp' | 'cn' | 'it' | 'fr' | 'sw' | 'il';
export type VehicleClass = 'research' | 'premium' | 'squad';

export interface BattleRating {
  ab: number;
  rb: number;
  sb: number;
}

export interface VehicleInfo {
  /** ID вики: 'ussr_t_34_1940' */
  id: string;
  /** По дереву, в котором стоит машина */
  nation: NationCode;
  /** Показываемое имя (G01): nameRu, если первая буква кириллическая, иначе nameEn */
  name: string;
  /** Имя русской вики (поиск) */
  nameRu: string;
  /** Имя английской вики (поиск, сопоставление со скриншотами) */
  nameEn: string;
  cls: VehicleClass;
  /** 1..8 */
  rank: number;
  /** null — страница машины не дала БР */
  br: BattleRating | null;
  /** ID машины или группы, от которой исследуется */
  req: string | null;
  /** Есть public/catalog/slots/<id>.webp */
  hasSlot: boolean;
}

export type Cell =
  | null
  | { t: 'v'; id: string }
  | { t: 'g'; id: string; nameRu: string; nameEn: string; items: string[]; req: string | null };

export interface RankBlock {
  /** 1..8 */
  rank: number;
  /** Строки × колонки (длина строки = researchColumns) */
  research: Cell[][];
  /** Строки × колонки (длина строки = premiumColumns) */
  premium: Cell[][];
}

export interface NationTree {
  code: NationCode;
  /** «СССР» */
  nameRu: string;
  /** 'flags/ussr.svg' относительно catalog/ */
  flag: string;
  researchColumns: number;
  premiumColumns: number;
  /** По возрастанию ранга */
  ranks: RankBlock[];
}

export interface TreeCatalog {
  version: 1;
  /** ISO */
  generatedAt: string;
  /** Порядок вкладок: us, germ, ussr, uk, jp, cn, it, fr, sw, il */
  nations: NationTree[];
  vehicles: Record<string, VehicleInfo>;
}

/** Коэффициент 0.01..10 (2 знака) или блок */
export type Value = { c: number } | { b: true };
/** Нет записи = { c: 1 } */
export type ValueMap = Record<string, Value>;

export interface Change {
  /** Растёт на 1 с каждой записью */
  seq: number;
  /** ISO */
  at: string;
  kind: 'edit' | 'undo' | 'import';
  /** Только реально изменившиеся машины */
  items: { id: string; from: Value; to: Value }[];
  /** seq отменённой записи (kind 'undo') */
  undoOf?: number;
}

export interface StateResponse {
  /** = seq последней записи; 0 — правок не было */
  version: number;
  values: ValueMap;
  /** Последние 100, новые первыми */
  changes: Change[];
}

export interface Edit {
  ids: string[];
  to: Value;
}
