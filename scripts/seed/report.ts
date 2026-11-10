/** Отчёт `docs/seed-report.md`: что перенесено со скриншотов, что нет и где читатель сомневался. */
import type { TreeCatalog } from '../../shared/types';
import type { MatchResult, RawItem, RawNation } from './match';

export interface NationReport {
  code: string;
  nameRu: string;
  /** null — raw-файла нации нет. */
  raw: RawNation | null;
  result: MatchResult | null;
  missingIds: string[];
}

const SECTION_RU = { research: 'исследуемая', premium: 'премиум/отряд' } as const;

function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function rawLine(item: RawItem): string {
  return `ранг ${item.rank}, ${SECTION_RU[item.section]}, «${item.name}», значение ${item.value}`;
}

/** Итог независимой сверки: `data/seed/verify/*.json` (`checked` — строк по нации, `mismatches` — расхождения, `notes` — заметки). */
export interface VerifyReport {
  /** Имя файла без расширения, например verify-a. */
  name: string;
  checked: Record<string, number>;
  mismatches: unknown[];
  notes?: string[];
}

function mismatchNation(m: unknown): string | null {
  const n = m && typeof m === 'object' ? (m as { nation?: unknown }).nation : undefined;
  return typeof n === 'string' ? n : null;
}

function verifySection(reports: NationReport[], verifies: VerifyReport[]): string[] {
  const out: string[] = ['## Как проверяли', ''];
  out.push(
    'Каждый скриншот прочитали два независимых читателя по одним и тем же фрагментам (`data/seed/tiles/`): первый записал `data/seed/raw/<nation>.json`, второй (по файлу на группу наций, `data/seed/verify/`) сверил каждую строку с карточкой. Расхождения между читателями решает третий взгляд, а то, что осталось спорным, помечается `doubt` и перечисляется в «Спорные места» нации. Ниже — сколько строк сверено и сколько расхождений нашлось; отметки `doubt` читателя-расшифровщика (обрезанные имена, одноимённые пары) к расхождениям не относятся, это оговорки о виде карточки.',
    '',
  );
  const names = verifies.map((v) => v.name);
  out.push(`| Нация | ${names.map((n) => `${n}: строк | ${n}: расхождений`).join(' | ')} |`);
  out.push(`|---|${names.map(() => '---|---').join('|')}|`);
  for (const r of reports) {
    const cols = verifies.map((v) => {
      const rows = v.checked[r.code];
      if (rows === undefined) return '— | —';
      return `${rows} | ${v.mismatches.filter((m) => mismatchNation(m) === r.code).length}`;
    });
    out.push(`| ${r.nameRu} (${r.code}) | ${cols.join(' | ')} |`);
  }
  out.push('');
  for (const v of verifies) {
    const total = Object.values(v.checked).reduce((a, b) => a + b, 0);
    out.push(`- ${v.name}: сверено строк ${total}, расхождений ${v.mismatches.length}.`);
  }
  out.push('');
  const found = verifies.flatMap((v) => v.mismatches.map((m) => `- ${v.name}: ${cell(JSON.stringify(m))}`));
  out.push('### Найденные расхождения', '');
  if (found.length === 0) out.push('Нет: все сверенные строки совпали с расшифровкой.', '');
  else out.push(...found, '');
  const notes = verifies.flatMap((v) => (v.notes ?? []).map((n) => `- ${v.name}: ${cell(n)}`));
  if (notes.length > 0) out.push('### Заметки проверяющих', '', ...notes, '');
  return out;
}

export function buildReport(reports: NationReport[], catalog: TreeCatalog, verifies: VerifyReport[] = []): string {
  const out: string[] = [];
  out.push('# Отчёт о стартовых значениях', '');
  out.push('Сгенерировано `npm run seed` из `data/seed/raw/*.json` и `public/catalog/trees.json`. Руками не править.', '');

  out.push('| Нация | Карточек на скриншоте | Сопоставлено | Не сопоставлено | Машин вики без значения | Спорных мест |');
  out.push('|---|---|---|---|---|---|');
  for (const r of reports) {
    const res = r.result;
    const doubts = (r.raw?.items.filter((i) => i.doubt).length ?? 0) + (res?.issues.length ?? 0);
    out.push(
      `| ${r.nameRu} (${r.code}) | ${r.raw ? r.raw.items.length : '—'} | ${res?.matched.length ?? 0} | ${res?.unmatched.length ?? 0} | ${r.missingIds.length} | ${doubts} |`,
    );
  }
  out.push('');

  if (verifies.length > 0) out.push(...verifySection(reports, verifies));

  for (const r of reports) {
    out.push(`## ${r.nameRu} (${r.code})`, '');
    if (!r.raw || !r.result) {
      out.push(`Для этой нации нет файла \`data/seed/raw/${r.code}.json\` (расшифровки скриншота): все ${r.missingIds.length} машин получают «1».`, '');
    } else {
      out.push(`- Источник: ${r.raw.source ?? '—'}`);
      out.push(`- Карточек на скриншоте: ${r.raw.items.length}`);
      out.push(`- Сопоставлено: ${r.result.matched.length}`);
      out.push(`- Не сопоставлено: ${r.result.unmatched.length}`);
      out.push(`- Машин вики без значения на скриншоте (получат «1»): ${r.missingIds.length}`, '');

      out.push('### Не сопоставлено', '');
      if (r.result.unmatched.length === 0) out.push('Нет.', '');
      else {
        for (const item of r.result.unmatched) out.push(`- ${rawLine(item)}`);
        out.push('');
      }
    }

    out.push('### Машины вики без значения на скриншоте', '');
    if (r.missingIds.length === 0) out.push('Нет.', '');
    else {
      for (const id of r.missingIds) {
        const v = catalog.vehicles[id];
        out.push(v ? `- ${cell(v.nameEn)} — ранг ${v.rank}, ${v.cls === 'research' ? 'исследуемая' : 'премиум/отряд'} (\`${id}\`)` : `- \`${id}\``);
      }
      out.push('');
    }

    out.push('### Спорные места', '');
    const lines: string[] = [];
    for (const item of r.raw?.items ?? []) if (item.doubt) lines.push(`- ${rawLine(item)}: ${item.doubt}`);
    for (const issue of r.result?.issues ?? []) lines.push(`- ${rawLine(issue.item)} → \`${issue.id}\`: ${issue.note}`);
    if (lines.length === 0) out.push('Нет.', '');
    else out.push(...lines, '');
  }
  return out.join('\n');
}
