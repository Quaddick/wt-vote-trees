import type { NationCode } from '../../shared/types';

export interface NationMeta {
  code: NationCode;
  /** `data-tree-id` дерева на вики и имя флага `country_<tree>.svg` */
  tree: string;
  nameRu: string;
}

/** Нации наземки в порядке вкладок сайта. */
export const NATIONS: readonly NationMeta[] = [
  { code: 'us', tree: 'usa', nameRu: 'США' },
  { code: 'germ', tree: 'germany', nameRu: 'Германия' },
  { code: 'ussr', tree: 'ussr', nameRu: 'СССР' },
  { code: 'uk', tree: 'britain', nameRu: 'Великобритания' },
  { code: 'jp', tree: 'japan', nameRu: 'Япония' },
  { code: 'cn', tree: 'china', nameRu: 'Китай' },
  { code: 'it', tree: 'italy', nameRu: 'Италия' },
  { code: 'fr', tree: 'france', nameRu: 'Франция' },
  { code: 'sw', tree: 'sweden', nameRu: 'Швеция' },
  { code: 'il', tree: 'israel', nameRu: 'Израиль' },
];

/** Нация по `data-tree-id`; чужое дерево («usa-copy» и т. п.) → null. */
export function nationFromTree(tree: string | undefined): NationMeta | null {
  return NATIONS.find((n) => n.tree === tree) ?? null;
}
