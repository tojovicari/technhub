import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../modules/integrations/worker.js', () => ({
  startIntegrationsWorker: vi.fn()
}));

vi.mock('../../modules/integrations/service.js', () => ({
  createConnection: vi.fn(),
  rotateSecret: vi.fn(),
  createSyncJob: vi.fn(),
  getSyncJob: vi.fn(),
  listConnections: vi.fn(),
  getConnection: vi.fn(),
  updateConnection: vi.fn(),
  deleteConnection: vi.fn()
}));

vi.mock('../../modules/integrations/webhooks.js', () => ({
  enqueueWebhookEvent: vi.fn(),
  getWebhookEventStatus: vi.fn(),
  processPendingWebhookEvents: vi.fn()
}));

vi.mock('../../modules/auth/service.js', () => ({
  register: vi.fn(),
  login: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
  getMe: vi.fn()
}));

import { buildApp } from '../../app.js';
import * as svc from '../../modules/auth/service.js';
import { makeToken } from '../../__tests__/helpers.js';
import type { FastifyInstance } from 'fastify';
import type { PlatformRole } from '@prisma/client';

const ACCOUNT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';

function makeAccount() {
  return {
    id: ACCOUNT_ID,
    tenant_id: 'ten_test',
    email: 'glauber@example.com',
    full_name: 'Glauber Test',
    role: 'org_admin' as PlatformRole,
    is_active: true as const,
    created_at: new Date().toISOString()
  };
}

describe('auth routes', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
    token = makeToken(app, { sub: ACCOUNT_ID });
  });

  afterAll(() => app.close());

  // ── POST /auth/register ──────────────────────────────────────────────────

  describe('POST /api/v1/auth/register', () => {
    it('201 on valid registration', async () => {
      vi.mocked(svc.register).mockResolvedValueOnce(makeAccount());

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          tenant_id: 'ten_test',
          email: 'glauber@example.com',
          password: 'Abcd1234',
          full_name: 'Glauber Test',
          role: 'org_admin'
        }
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().data.email).toBe('glauber@example.com');
    });

    it('400 when password too short', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          tenant_id: 'ten_test',
          email: 'x@x.com',
          password: 'short',
          full_name: 'X'
        }
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('409 when email already taken', async () => {
      vi.mocked(svc.register).mockRejectedValueOnce(
        Object.assign(new Error('Email already registered'), { code: 'EMAIL_TAKEN' })
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          tenant_id: 'ten_test',
          email: 'dupe@example.com',
          password: 'Abcd1234',
          full_name: 'Dupe'
        }
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('EMAIL_TAKEN');
    });
  });

  // ── POST /auth/login ─────────────────────────────────────────────────────

  describe('POST /api/v1/auth/login', () => {
    it('200 with tokens on valid credentials', async () => {
      vi.mocked(svc.login).mockResolvedValueOnce({
        access_token: 'tok',
        refresh_token: 'ref',
        token_type: 'Bearer',
        expires_in: 3600,
        account: makeAccount()
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'glauber@example.com', password: 'Abcd1234' }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.access_token).toBe('tok');
      expect(res.json().data.refresh_token).toBe('ref');
    });

    it('401 on bad credentials', async () => {
      vi.mocked(svc.login).mockRejectedValueOnce(
        Object.assign(new Error('Invalid credentials'), { code: 'INVALID_CREDENTIALS' })
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'x@x.com', password: 'WrongPass1' }
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
    });
  });

  // ── POST /auth/refresh ───────────────────────────────────────────────────

  describe('POST /api/v1/auth/refresh', () => {
    it('200 returns new tokens', async () => {
      vi.mocked(svc.refresh).mockResolvedValueOnce({
        access_token: 'new-tok',
        refresh_token: 'new-ref',
        token_type: 'Bearer',
        expires_in: 3600
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refresh_token: 'old-ref' }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.access_token).toBe('new-tok');
    });

    it('401 on expired refresh token', async () => {
      vi.mocked(svc.refresh).mockRejectedValueOnce(
        Object.assign(new Error('Expired'), { code: 'INVALID_REFRESH_TOKEN' })
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refresh_token: 'expired' }
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ── GET /auth/me ─────────────────────────────────────────────────────────

  describe('GET /api/v1/auth/me', () => {
    it('200 returns current account', async () => {
      vi.mocked(svc.getMe).mockResolvedValueOnce({
        ...makeAccount(),
        last_login_at: null
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { Authorization: `Bearer ${token}` }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.email).toBe('glauber@example.com');
    });

    it('401 without token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
      expect(res.statusCode).toBe(401);
    });
  });
});
