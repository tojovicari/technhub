import type { AuthTokenPayload } from '../auth/core/auth.types';

declare module 'fastify' {
  interface FastifyRequest {
    /** Populado por `requireAuth` a partir do access token verificado. */
    user?: AuthTokenPayload;
  }
}
