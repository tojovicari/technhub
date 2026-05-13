import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// ── Mock all service layers (must precede app imports) ───────────────────────

vi.mock('../../modules/integrations/worker.js', () => ({
  startIntegrationsWorker: vi.fn()
}));

vi.mock('../../modules/core/service.js', () => ({
  createTeam: vi.fn(),
  createProject: vi.fn(),
  getProject: vi.fn(),
  createEpic: vi.fn(),
  getEpic: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  getTask: vi.fn(),
  upsertUser: vi.fn(),
  listUsers: vi.fn(),
  addTeamMember: vi.fn(),
  removeTeamMember: vi.fn(),
  listTeamMembers: vi.fn(),
  listProjects: vi.fn(),
  listEpics: vi.fn(),
  listTasks: vi.fn()
}));

vi.mock('../../modules/integrations/service.js', () => ({
  createConnection: vi.fn(),
  rotateSecret: vi.fn(),
  createSyncJob: vi.fn(),
  getSyncJob: vi.fn()
}));

vi.mock('../../modules/integrations/webhooks.js', () => ({
  enqueueWebhookEvent: vi.fn(),
  getWebhookEventStatus: vi.fn(),
  processPendingWebhookEvents: vi.fn()
}));

vi.mock('../../modules/sla/service.js', () => ({
  createSlaTemplate: vi.fn(),
  listSlaTemplates: vi.fn(),
  getSlaTemplate: vi.fn(),
  updateSlaTemplate: vi.fn(),
  deleteSlaTemplate: vi.fn(),
  evaluateTaskSla: vi.fn(),
  listSlaInstances: vi.fn()
}));

vi.mock('./service.js', () => ({
  ingestDeployEvent: vi.fn(),
  computeDoraScorecard: vi.fn(),
  listDeployEvents: vi.fn(),
  ingestLeadTimeEvent: vi.fn(),
  listHealthMetrics: vi.fn()
}));

vi.mock('../../modules/billing/entitlement.js', () => ({
  requireModule: () => async () => {},
  requireFeature: () => async () => {},
  loadEntitlement: vi.fn(),
  invalidateEntitlementCache: vi.fn()
}));

import { buildApp } from '../../app.js';
import * as doraSvc from './service.js';
import type { FastifyInstance } from 'fastify';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT = 'ten_test';
const DEPLOY_ID = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';

function makeDeployEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: DEPLOY_ID,
    tenantId: TENANT,
    projectId: null,
    source: 'manual',
    externalId: null,
    ref: 'v1.2.3',
    commitSha: null,
    environment: 'production',
    deployedAt: new Date().toISOString(),
    isHotfix: false,
    isRollback: false,
    prIds: [],
    rawPayload: null,
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

function makeScorecard() {
  return {
    window_days: 30,
    window_start: new Date(Date.now() - 30 * 86400000).toISOString(),
    window_end: new Date().toISOString(),
    project_id: null,
    overall_level: 'high',
    deployment_frequency: { value: 0.5, unit: 'per_day', level: 'high', deploy_count: 15 },
    lead_time: null,
    mttr: null,
    change_failure_rate: null
  };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('DORA routes', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-do-not-use-in-production';
    process.env['AUTH_BYPASS'] = 'false';
    app = buildApp();
    await app.ready();
    token = app.jwt.sign({
      sub: 'user-1',
      tenant_id: TENANT,
      roles: ['admin'],
      permissions: ['*']
    });
  });

  afterAll(() => app.close());

  // ── POST /dora/deploys ────────────────────────────────────────────────────

  describe('POST /api/v1/dora/deploys', () => {
    it('201: ingests deploy event', async () => {
      vi.mocked(doraSvc.ingestDeployEvent).mockResolvedValueOnce(makeDeployEvent() as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/dora/deploys',
        headers: { authorization: `Bearer ${token}` },
        body: {
          ref: 'v1.2.3',
          deployed_at: new Date().toISOString()
        }
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().data.id).toBe(DEPLOY_ID);
      expect(doraSvc.ingestDeployEvent).toHaveBeenCalledWith(TENANT, expect.any(Object));
    });

    it('400: missing ref', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/dora/deploys',
        headers: { authorization: `Bearer ${token}` },
        body: { deployed_at: new Date().toISOString() }
      });
      expect(res.statusCode).toBe(400);
    });

    it('401: no token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/dora/deploys',
        body: {}
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── GET /dora/deploys ─────────────────────────────────────────────────────

  describe('GET /api/v1/dora/deploys', () => {
    it('200: returns paginated list', async () => {
      vi.mocked(doraSvc.listDeployEvents).mockResolvedValueOnce({
        data: [makeDeployEvent() as any],
        next_cursor: null
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/dora/deploys',
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.data).toHaveLength(1);
      expect(res.json().data.next_cursor).toBeNull();
    });

    it('401: no token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/dora/deploys' });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── GET /dora/scorecard ───────────────────────────────────────────────────

  describe('GET /api/v1/dora/scorecard', () => {
    it('200: returns scorecard', async () => {
      vi.mocked(doraSvc.computeDoraScorecard).mockResolvedValueOnce(makeScorecard() as any);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/dora/scorecard',
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json().data;
      expect(body.overall_level).toBe('high');
      expect(body.deployment_frequency.level).toBe('high');
      expect(doraSvc.computeDoraScorecard).toHaveBeenCalledWith(TENANT, expect.any(Object));
    });

    it('400: invalid window_days', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/dora/scorecard?window_days=999',
        headers: { authorization: `Bearer ${token}` }
      });
      expect(res.statusCode).toBe(400);
    });

    it('401: no token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/dora/scorecard' });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── POST /dora/lead-time ──────────────────────────────────────────────────

  describe('POST /api/v1/dora/lead-time', () => {
    it('201: ingests lead time event', async () => {
      vi.mocked(doraSvc.ingestLeadTimeEvent).mockResolvedValueOnce({
        skipped: false,
        lead_time_hours: 4,
        metric_id: 'some-uuid'
      });

      const now = new Date();
      const fourHoursAgo = new Date(now.getTime() - 4 * 3_600_000);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/dora/lead-time',
        headers: { authorization: `Bearer ${token}` },
        body: {
          pr_id: 'PR-42',
          first_commit_at: fourHoursAgo.toISOString(),
          merged_at: now.toISOString()
        }
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().data.lead_time_hours).toBe(4);
    });

    it('400: missing pr_id', async () => {
      const now = new Date();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/dora/lead-time',
        headers: { authorization: `Bearer ${token}` },
        body: { first_commit_at: now.toISOString(), merged_at: now.toISOString() }
      });
      expect(res.statusCode).toBe(400);
    });

    it('401: no token', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/dora/lead-time', body: {} });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── GET /dora/history/:metric_name ────────────────────────────────────────

  describe('GET /api/v1/dora/history/:metric_name', () => {
    it('200: returns historical snapshots', async () => {
      vi.mocked(doraSvc.listHealthMetrics).mockResolvedValueOnce({
        data: [
          {
            id: 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee',
            tenantId: TENANT,
            metricName: 'deployment_frequency',
            value: 0.8,
            unit: 'per_day',
            level: 'high',
            windowDays: 30,
            computedAt: new Date()
          } as any
        ],
        next_cursor: null
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/dora/history/deployment_frequency',
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.data).toHaveLength(1);
      expect(doraSvc.listHealthMetrics).toHaveBeenCalledWith(
        TENANT,
        expect.objectContaining({ metric_name: 'deployment_frequency' })
      );
    });

    it('401: no token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/dora/history/deployment_frequency'
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
