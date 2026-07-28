/**
 * Extrai o `.code` de um erro do driver `pg` (ex: '23503' = foreign_key_violation,
 * '23505' = unique_violation) sem recorrer a `any`.
 *
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
export function getPgErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  const { code } = error as { code: unknown };
  return typeof code === 'string' ? code : undefined;
}
