const DEFAULT_PUBLIC_API_URL = 'http://127.0.0.1:3000';

/**
 * URL pública de onde este backend é acessível — usada para montar links
 * absolutos em conteúdo enviado a pessoas fora do processo (ex: link de
 * login no email de convite). Não é derivada de
 * `request.protocol`/`request.hostname` porque o Fastify não tem
 * `trustProxy` configurado — atrás de um proxy (Fly.io) isso resolveria
 * errado. Mesmo motivo de `GITHUB_OAUTH_CALLBACK_URL` já ser env var
 * explícita.
 */
export function getPublicApiUrl(): string {
  return process.env.PUBLIC_API_URL ?? DEFAULT_PUBLIC_API_URL;
}
