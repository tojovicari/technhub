/**
 * Erros de negócio do módulo de billing — a camada de rotas mapeia
 * `.code` pro status HTTP correspondente (`getPgErrorCode` faz o mesmo pra
 * erros de constraint do Postgres; isso é o equivalente pra erro de regra
 * de negócio que não vem do banco).
 */
export type BillingErrorCode = 'NOT_FOUND' | 'VALIDATION_ERROR' | 'PRECONDITION_FAILED';

export class BillingError extends Error {
  constructor(
    message: string,
    readonly code: BillingErrorCode,
  ) {
    super(message);
    this.name = 'BillingError';
  }
}
