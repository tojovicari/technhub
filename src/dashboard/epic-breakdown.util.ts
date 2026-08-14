import type { EpicWorkBreakdown } from './team-profile.service';

export interface EpicBreakdownRow {
  readonly epic_external_id: string | null;
  readonly epic_external_name: string | null;
  readonly semantic_category: string;
  readonly count: string;
}

/**
 * Agrega linhas de `epic_external_id/name, semantic_category, count` (já
 * filtradas por `is_epic_container = false`) em blocos por épico, com
 * `share` (fração 0-1) dentro de cada bloco — `epic_external_id` nulo vira
 * o bucket "sem épico" explícito (`epic: null`), mesmo espírito de
 * `team: null` em `PersonProfileTeamBreakdown`.
 *
 * Compartilhado entre `TeamProfileService.getEpicBreakdown` e
 * `PersonProfileService.getEpicBreakdown` — mesma lógica de agregação, só a
 * query que produz as linhas muda (filtro por `team_id` vs. por alias da
 * pessoa).
 */
export function buildEpicBreakdown(rows: readonly EpicBreakdownRow[]): readonly EpicWorkBreakdown[] {
  const byEpicId = new Map<
    string,
    {
      readonly epic: { readonly id: string; readonly name: string | null } | null;
      readonly counts: Map<string, number>;
    }
  >();

  for (const row of rows) {
    const key = row.epic_external_id ?? '';
    const existing = byEpicId.get(key);
    const counts = existing?.counts ?? new Map<string, number>();
    counts.set(row.semantic_category, Number(row.count));

    if (!existing) {
      byEpicId.set(key, {
        epic: row.epic_external_id ? { id: row.epic_external_id, name: row.epic_external_name } : null,
        counts,
      });
    }
  }

  const epics: EpicWorkBreakdown[] = [...byEpicId.values()].map(({ epic, counts }) => {
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    const byCategory = [...counts.entries()]
      .map(([category, count]) => ({ category, count, share: count / total }))
      .sort((a, b) => a.category.localeCompare(b.category));

    return { epic, total, byCategory };
  });

  epics.sort((a, b) => (a.epic?.name ?? a.epic?.id ?? '').localeCompare(b.epic?.name ?? b.epic?.id ?? ''));

  return epics;
}
