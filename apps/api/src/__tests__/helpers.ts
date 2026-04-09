import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';

export type TestApp = FastifyInstance;

export async function createTestApp(): Promise<TestApp> {
  process.env.JWT_SECRET = 'test-secret-do-not-use-in-production';
  const app = buildApp();
  await app.ready();
  return app;
}

export function makeToken(
  app: TestApp,
  claims: {
    sub?: string;
    tenant_id?: string;
    roles?: string[];
    permissions?: string[];
  } = {}
): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (app as any).jwt.sign({
    sub: 'usr_test',
    tenant_id: 'ten_test',
    roles: ['admin'],
    permissions: ['*'],
    ...claims
  });
}
