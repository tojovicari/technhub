/**
 * `from`/`to` **ausentes os dois** → all-time (`null`, comportamento
 * idêntico ao original de um endpoint sem período). Um presente e o outro
 * ausente → `'invalid'` (não existe default parcial aqui — diferente de
 * `parseDateOrDefault` em `dashboard.routes.ts`, que sempre preenche um
 * default de 30 dias; endpoints que usam isto precisam que a ausência do
 * param signifique all-time de verdade, não um período implícito). Os dois
 * presentes → parseados como ISO 8601; inválido → `'invalid'`.
 *
 * Extraído de `team-profile.routes.ts` pra ser reaproveitado por
 * `person-profile.routes.ts` sem duplicar (mesma regra nos dois).
 */
export function parseOptionalPeriod(
  from: string | undefined,
  to: string | undefined,
): { from: Date; to: Date } | null | 'invalid' {
  if (!from && !to) {
    return null;
  }
  if (!from || !to) {
    return 'invalid';
  }

  const parsedFrom = new Date(from);
  const parsedTo = new Date(to);
  if (Number.isNaN(parsedFrom.getTime()) || Number.isNaN(parsedTo.getTime())) {
    return 'invalid';
  }

  return { from: parsedFrom, to: parsedTo };
}
