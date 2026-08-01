import type { AuthTokenPayload, PlatformOperatorTokenPayload } from '../auth/core/auth.types';

declare module 'fastify' {
  interface FastifyRequest {
    /** Populado por `requireAuth` a partir do access token verificado. */
    user?: AuthTokenPayload;
    /**
     * Populado por `requirePlatformOperator` — decoração à parte de `user`
     * de propósito, pra rota tenant-scoped nenhuma precisar considerar essa
     * forma (ver `PlatformOperatorTokenPayload`).
     */
    platformOperator?: PlatformOperatorTokenPayload;
  }
}
