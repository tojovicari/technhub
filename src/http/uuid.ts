const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Valida o formato de um path param antes de usá-lo numa query contra uma
 * coluna `UUID` — sem isso, um valor não-UUID (ex: um `provider` antigo
 * batendo numa rota que migrou de `:provider` pra `:integrationId`) derruba
 * a query com `22P02` (erro de sintaxe do driver `pg`), que sobe como `500`
 * cru em vez de um `404`/`400` limpo.
 */
export function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
