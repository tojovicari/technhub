const DEFAULT_FRONTEND_URL = 'http://localhost:5183';

/** URL do front (SPA) — usado pro CORS e pro redirect final do callback OAuth. */
export function getFrontendUrl(): string {
  return process.env.FRONTEND_URL ?? DEFAULT_FRONTEND_URL;
}
