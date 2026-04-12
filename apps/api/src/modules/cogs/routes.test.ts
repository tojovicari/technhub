import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// ── Mock all service layers (must precede app imports) ───────────────────────

vi.mock('../../modules/integrations/worker.js', () => ({
  startIntegrationsWorker: vi.fn()
}));

vi.mock('../../modules/core/service.js', () => ({
  createTeam: vi.fn(), createProject: vi.fn(), getProject: vi.fn(),
  createEpic: vi.fn(), getEpic: vi.fn(), createTask: vi.fn(),
  updateTask: vi.fn(), getTask: vi.fn(), upsertUser: vi.fn(),
  listUsers: vi.fn(), addTeamMember: vi.fn(), removeTeamMember: vi.fn(),
  listTeamMembers: vi.fn(), listProjects: vi.fn(), listEpics: vi.fn(), listTasks: vi.fn()
}));

vi.mock('../../modules/integrations/service.js', () => ({
  createConnection: vi.fn(), rotateSecret: vi.fn(),
  createSyncJob: vi.fn(), getSyncJob: vi.fn()
}));

vi.mock('../../modules/integrations/webhooks.js', () => ({
  enqueueWebhookEvent: vi.fn(), getWebhookEventStatus: vi.fn(),
  processPendingWebhookEvents: vi.fn()
}));

vi.mock('../../modules/sla/service.js', () => ({
  createSlaTemplate: vi.fn(), listSlaTemplates: vi.fn(), getSlaTemplate: vi.fn(),
  updateSlaTemplate: vi.fn(), deleteSlaTemplate: vi.fn(),
  evaluateTaskSla: vi.fn(), listSlaInstances: vi.fn()
}));

vi.mock('../../modules/dora/service.js', () => ({
  ingestDeployEvent: vi.fn(), computeDoraScorecard: vi.fn(),
  listDeployEvents: vi.fn(), ingestLeadTimeEvent: vi.fn(), listHealthMetrics: vi.fn()
}));

vi.mock('./service.js', () => ({
  createCogsEntry: vi.fn(),
  createCogsEntryFromStoryPoints: vi.fn(),
  listCogsEntries: vi.fn(),
  computeCogsRollup: vi.fn(),
  createCogsBudget: vi.fn(),
  listCogsBudgets: vi.fn(),
  getBurnRate: vi.fn(),
  getEpicCogsAnalysis: vi.fn(),
  generateInitiativeCogs: vi.fn(),
  getInitiativeCogsSummary: vi.fn()
}));

import { buildApp } from '../../app.js';
import * as cogsSvc from './service.js';
import type { FastifyInstance } from 'fastify';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT = 'ten_test';
const ENTRY_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const EPIC_ID  = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const BUDGET_ID = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
const PROJECT_ID = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: ENTRY_ID,
    tenantId: TENANT,
    periodDate: '2026-04-01',
    userId: null,
    teamId: null,
    projectId: null,
    epicId: null,
    taskId: null,
    hoursWorked: 8,
    hourlyRate: 100,
    overheadRate: 1.3,
    totalCost: 1040,
    category: 'engineering',
    subcategory: null,
    source: 'timetracking',
    confidence: 'high',
    notes: null,
    approvedBy: null,
    metadata: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

function makeRollup() {
  return {
    total_cost: 5200,
    total_hours: 40,
    cost_per_story_point: null,
    group_by: 'category',
    breakdown: { engineering: 5200 },
    entry_count: 5,
    filters: { project_id: null, epic_id: null, team_id: null, user_id: null, date_from: null, date_to: null }
  };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('COGS routes', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
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

  // ── POST /cogs/entries ────────────────────────────────────────────────────

  describe('POST /api/v1/cogs/entries', () => {
    it('201: creates entry', async () => {
      vi.mocked(cogsSvc.createCogsEntry).mockResolvedValueOnce(makeEntry() as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/cogs/entries',
        headers: { authorization: `Bearer ${token}` },
        body: {
          period_date: '2026-04-01',
          hours_worked: 8,
          hourly_rate: 100,
          overhead_rate: 1.3,
          category: 'engineering',
          source: 'timetracking'
        }
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().data.totalCost).toBe(1040);
      expect(cogsSvc.createCogsEntry).toHaveBeenCalledWith(TENANT, expect.any(Object));
    });

    it('400: missing category', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/cogs/entries',
        headers: { authorization: `Bearer ${token}` },
        body: { period_date: '2026-04-01', hours_worked: 8, hourly_rate: 100, source: 'manual' }
      });
      expect(res.statusCode).toBe(400);
    });

    it('401: no token', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/cogs/entries', body: {} });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── GET /cogs/entries ─────────────────────────────────────────────────────

  describe('GET /api/v1/cogs/entries', () => {
    it('200: returns paginated entries', async () => {
      vi.mocked(cogsSvc.listCogsEntries).mockResolvedValueOnce({
        data: [makeEntry() as any],
        next_cursor: null
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/cogs/entries',
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.data).toHaveLength(1);
      expect(res.json().data.next_cursor).toBeNull();
    });

    it('200: filters by category', async () => {
      vi.mocked(cogsSvc.listCogsEntries).mockResolvedValueOnce({ data: [], next_cursor: null });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/cogs/entries?category=tooling',
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.statusCode).toBe(200);
      expect(cogsSvc.listCogsEntries).toHaveBeenCalledWith(TENANT, expect.objectContaining({ category: 'tooling' }));
    });

    it('401: no token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/cogs/entries' });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── GET /cogs/rollup ──────────────────────────────────────────────────────

  describe('GET /api/v1/cogs/rollup', () => {
    it('200: returns rollup by category', async () => {
      vi.mocked(cogsSvc.computeCogsRollup).mockResolvedValueOnce(makeRollup() as any);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/cogs/rollup?group_by=category',
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.total_cost).toBe(5200);
      expect(res.json().data.breakdown.engineering).toBe(5200);
    });

    it('401: no token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/cogs/rollup' });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── GET /cogs/epics/:epic_id ──────────────────────────────────────────────

  describe('GET /api/v1/cogs/epics/:epic_id', () => {
    it('200: returns epic analysis', async () => {
      vi.mocked(cogsSvc.getEpicCogsAnalysis).mockResolvedValueOnce({
        epic_id: EPIC_ID,
        epic_name: 'Payments v2',
        epic_status: 'active',
        actual_cost: 8000,
        estimated_cost: 7000,
        business_value: 50000,
        roi_percent: 525,
        planned_vs_actual: { estimatedCost: 7000, actualCost: 8000, deviationPercent: 114.29, status: 'at_risk' },
        cost_by_category: { engineering: 8000 },
        total_hours: 80
      } as any);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/cogs/epics/${EPIC_ID}`,
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.roi_percent).toBe(525);
      expect(res.json().data.planned_vs_actual.status).toBe('at_risk');
    });

    it('404: epic not found', async () => {
      vi.mocked(cogsSvc.getEpicCogsAnalysis).mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/cogs/epics/${EPIC_ID}`,
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.statusCode).toBe(404);
    });

    it('401: no token', async () => {
      const res = await app.inject({ method: 'GET', url: `/api/v1/cogs/epics/${EPIC_ID}` });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── POST /cogs/budgets ────────────────────────────────────────────────────

  describe('POST /api/v1/cogs/budgets', () => {
    it('201: creates budget', async () => {
      vi.mocked(cogsSvc.createCogsBudget).mockResolvedValueOnce({
        id: BUDGET_ID, tenantId: TENANT, projectId: null, teamId: null,
        period: '2026-Q2', budgetAmount: 50000, currency: 'USD',
        notes: null, createdAt: new Date(), updatedAt: new Date()
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/cogs/budgets',
        headers: { authorization: `Bearer ${token}` },
        body: { period: '2026-Q2', budget_amount: 50000 }
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().data.id).toBe(BUDGET_ID);
    });

    it('400: invalid period format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/cogs/budgets',
        headers: { authorization: `Bearer ${token}` },
        body: { period: 'invalid', budget_amount: 50000 }
      });
      expect(res.statusCode).toBe(400);
    });

    it('401: no token', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/cogs/budgets', body: {} });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── GET /cogs/burn-rate ───────────────────────────────────────────────────

  describe('GET /api/v1/cogs/burn-rate', () => {
    it('200: returns burn rate', async () => {
      vi.mocked(cogsSvc.getBurnRate).mockResolvedValueOnce({
        period: '2026-Q2',
        period_start: '2026-04-01',
        period_end: '2026-06-30',
        project_id: null,
        team_id: null,
        actualCost: 32000,
        budgetAmount: 50000,
        burnPercent: 64,
        remaining: 18000,
        status: 'on_track',
        budget_configured: true
      } as any);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/cogs/burn-rate?period=2026-Q2',
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe('on_track');
      expect(res.json().data.burnPercent).toBe(64);
    });

    it('400: missing period', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/cogs/burn-rate',
        headers: { authorization: `Bearer ${token}` }
      });
      expect(res.statusCode).toBe(400);
    });

    it('401: no token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/cogs/burn-rate?period=2026-Q2' });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── POST /cogs/initiatives/:project_id/generate ────────────────────────

  describe('POST /api/v1/cogs/initiatives/:project_id/generate', () => {
    it('200: returns generation stats', async () => {
      vi.mocked(cogsSvc.generateInitiativeCogs).mockResolvedValueOnce({
        results: [
          { taskId: 'task-1', outcome: 'created' },
          { taskId: 'task-2', outcome: 'skipped', reason: 'cancelled_no_hours' }
        ],
        stats: { created: 1, recreated: 0, skipped: 1, no_rate: 0 }
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/cogs/initiatives/${PROJECT_ID}/generate`,
        headers: { authorization: `Bearer ${token}` },
        body: { overhead_rate: 1.3 }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.stats.created).toBe(1);
      expect(cogsSvc.generateInitiativeCogs).toHaveBeenCalledWith(TENANT, PROJECT_ID, 1.3);
    });

    it('200: uses default overhead_rate when body is empty', async () => {
      vi.mocked(cogsSvc.generateInitiativeCogs).mockResolvedValueOnce({
        results: [], stats: { created: 0, recreated: 0, skipped: 0, no_rate: 0 }
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/cogs/initiatives/${PROJECT_ID}/generate`,
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.statusCode).toBe(200);
      expect(cogsSvc.generateInitiativeCogs).toHaveBeenCalledWith(TENANT, PROJECT_ID, 1.3);
    });

    it('404: initiative not found', async () => {
      vi.mocked(cogsSvc.generateInitiativeCogs).mockRejectedValueOnce(new Error('INITIATIVE_NOT_FOUND'));

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/cogs/initiatives/${PROJECT_ID}/generate`,
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.statusCode).toBe(404);
    });

    it('400: invalid overhead_rate', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/cogs/initiatives/${PROJECT_ID}/generate`,
        headers: { authorization: `Bearer ${token}` },
        body: { overhead_rate: 0.5 } // below min 1
      });
      expect(res.statusCode).toBe(400);
    });

    it('401: no token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/cogs/initiatives/${PROJECT_ID}/generate`
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── GET /cogs/initiatives/:project_id/summary ─────────────────────────

  describe('GET /api/v1/cogs/initiatives/:project_id/summary', () => {
    it('200: returns initiative cost summary', async () => {
      vi.mocked(cogsSvc.getInitiativeCogsSummary).mockResolvedValueOnce({
        project_id: PROJECT_ID,
        project_name: 'Platform Core',
        project_status: 'active',
        total_cost: 15000,
        delivery_cost: 13000,
        waste_cost: 2000,
        waste_percent: 13.33,
        total_hours: 150,
        delivery_hours: 130,
        waste_hours: 20,
        entry_count: 25,
        confidence_distribution: { high: 20, medium: 3, low: 2 },
        by_epic: { 'epic-1': { total_cost: 8000, hours: 80, delivery_cost: 7000, waste_cost: 1000 } }
      } as any);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/cogs/initiatives/${PROJECT_ID}/summary`,
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json().data;
      expect(body.total_cost).toBe(15000);
      expect(body.waste_cost).toBe(2000);
      expect(body.waste_percent).toBe(13.33);
      expect(body.confidence_distribution.high).toBe(20);
    });

    it('404: non-initiative project', async () => {
      vi.mocked(cogsSvc.getInitiativeCogsSummary).mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/cogs/initiatives/${PROJECT_ID}/summary`,
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.statusCode).toBe(404);
    });

    it('401: no token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/cogs/initiatives/${PROJECT_ID}/summary`
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
