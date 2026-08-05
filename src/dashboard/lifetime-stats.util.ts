/**
 * Mediana de um array já ordenado ascendente — extraído de
 * `team-profile.service.ts` pra ser reaproveitado por `person-profile.service.ts`
 * sem duplicar (as duas contas de tempo de vida por categoria,
 * `completed_at - started_working_at`, usam exatamente a mesma fórmula).
 */
export function medianOfSorted(sortedAscValues: readonly number[]): number {
  const mid = Math.floor(sortedAscValues.length / 2);
  return sortedAscValues.length % 2 !== 0
    ? sortedAscValues[mid]
    : (sortedAscValues[mid - 1] + sortedAscValues[mid]) / 2;
}

export interface LifetimeStats {
  readonly lifetimeSampleSize: number;
  readonly avgLifetimeHours: number | null;
  readonly medianLifetimeHours: number | null;
}

/** `hoursSample` = lista de `(completed_at - started_working_at)` em horas, já filtrada a itens com `started_working_at` preenchido. */
export function computeLifetimeStats(hoursSample: readonly number[]): LifetimeStats {
  if (hoursSample.length === 0) {
    return { lifetimeSampleSize: 0, avgLifetimeHours: null, medianLifetimeHours: null };
  }

  const sorted = [...hoursSample].sort((a, b) => a - b);
  return {
    lifetimeSampleSize: sorted.length,
    avgLifetimeHours: sorted.reduce((sum, h) => sum + h, 0) / sorted.length,
    medianLifetimeHours: medianOfSorted(sorted),
  };
}
