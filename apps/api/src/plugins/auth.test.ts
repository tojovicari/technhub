import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Mock worker to prevent setInterval from keeping the process alive
vi.mock('../modules/integrations/worker.js', () => ({
  startIntegrationsWorker: vi.fn()
}));

// Mock Prisma to avoid requiring a real DB connection
vi.mock('../lib/prisma.js', () => ({ prisma: {} }));

import { ensureTenantScope, registerAuth } from './auth.js';
import { buildApp } from '../app.js';
import { makeToken } from '../__tests__/helpers.js';
import type { TestApp } from '../__tests__/helpers.js';
import Fastify from 'fastify';

// ─── ensureTenantScope (pure function) ───────────────────────────────────────

describe('ensureTenantScope', () => {
  function makeReply() {
    const reply = { status: vi.fn(), send: vi.fn() };
    reply.status.mockReturnValue(reply);
    reply.send.mockReturnValue(reply);
    return reply;
  }

  it('returns null when tenants match', () => {
    const request = { user: { tenant_id: 'ten_A' }, id: 'req-1' } as never;
    const result = ensureTenantScope(request, makeReply() as never, 'ten_A');
    expect(result).toBeNull();
  });

  it('rejects with 403 when tenants differ', () => {
    const request = { user: { tenant_id: 'ten_A' }, id: 'req-1' } as never;
    const reply = makeReply();
    ensureTenantScope(request, reply as never, 'ten_B');
    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'FORBIDDEN' })
      })
    );
  });

  it('rejects with 403 when body tenant_id is missing', () => {
    const request = { user: { tenant_id: 'ten_A' }, id: 'req-1' } as never;
    const reply = makeReply();
    ensureTenantScope(request, reply as never, undefined);
    expect(reply.status).toHaveBeenCalledWith(403);
  });

  it('rejects with 403 when JWT has no tenant_id', () => {
    const request = { user: {}, id: 'req-1' } as never;
    const reply = makeReply();
    ensureTenantScope(request, reply as never, 'ten_A');
    expect(reply.status).toHaveBeenCalledWith(403);
  });
});

// ─── Auth decorators via HTTP ────────────────────────────────────────────────

describe('Auth decorators', () => {
  let app: TestApp;
  let token: string;

  // Register a minimal test route that exercises both decorators
  // IMPORTANT: routes must be added BEFORE app.ready()
  beforeAll(async () => {
    delete process.env.AUTH_BYPASS;
    process.env.JWT_SECRET = 'test-secret-do-not-use-in-production';
    app = buildApp() as TestApp;

    app.get('/test/auth', {
      preHandler: [app.authenticate, app.requirePermission('test.read')]
    }, async () => ({ ok: true }));

    await app.ready();
    token = makeToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 401 when no Authorization header is provided', async () => {
    const res = await app.inject({ method: 'GET', url: '/test/auth' });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when token is malformed', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/test/auth',
      headers: { authorization: 'Bearer not.a.valid.jwt' }
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when permission is missing', async () => {
    const token = makeToken(app, { permissions: ['other.read'] });
    const res = await app.inject({
      method: 'GET',
      url: '/test/auth',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.details.required_permission).toBe('test.read');
  });

  it('returns 200 when token has wildcard permission', async () => {
    const token = makeToken(app, { permissions: ['*'] });
    const res = await app.inject({
      method: 'GET',
      url: '/test/auth',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns 200 when token has the exact required permission', async () => {
    const token = makeToken(app, { permissions: ['test.read'] });
    const res = await app.inject({
      method: 'GET',
      url: '/test/auth',
      headers: { authorization: `Bearer ${token}` }
    });
    expect(res.statusCode).toBe(200);
  });

  it('injects dev user when AUTH_BYPASS is true', async () => {
    process.env.AUTH_BYPASS = 'true';
    const res = await app.inject({ method: 'GET', url: '/test/auth' });
    // With wildcard permission from DEV_USER the route should pass
    expect(res.statusCode).toBe(200);
    delete process.env.AUTH_BYPASS;
  });
});

// ─── AUTH_BYPASS production guard ────────────────────────────────────────────

describe('AUTH_BYPASS production guard', () => {
  it('throws on startup when AUTH_BYPASS=true and NODE_ENV=production', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.AUTH_BYPASS = 'true';
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'test-secret-do-not-use-in-production';

    const app = Fastify();
    app.register(registerAuth);

    await expect(app.ready()).rejects.toThrow('AUTH_BYPASS is not allowed in production');

    await app.close().catch(() => {});
    delete process.env.AUTH_BYPASS;
    process.env.NODE_ENV = originalEnv;
  });

  it('does not throw when AUTH_BYPASS=true and NODE_ENV=test', async () => {
    process.env.AUTH_BYPASS = 'true';
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-do-not-use-in-production';

    const app = Fastify();
    app.register(registerAuth);

    await expect(app.ready()).resolves.not.toThrow();

    await app.close();
    delete process.env.AUTH_BYPASS;
  });

  it('does not throw when AUTH_BYPASS is not set and NODE_ENV=production', async () => {
    delete process.env.AUTH_BYPASS;
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'test-secret-do-not-use-in-production';

    const app = Fastify();
    app.register(registerAuth);

    await expect(app.ready()).resolves.not.toThrow();

    await app.close();
  });
});
