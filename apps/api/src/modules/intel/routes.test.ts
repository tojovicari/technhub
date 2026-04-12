import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// ── Mock all service layers (must precede app imports) ────────────────────────

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

vi.mock('../../modules/cogs/service.js', () => ({
  createCogsEntry: vi.fn(), createCogsEntryFromStoryPoints: vi.fn(),
  listCogsEntries: vi.fn(), computeCogsRollup: vi.fn(),
  createCogsBudget: vi.fn(), listCogsBudgets: vi.fn(),
  getBurnRate: vi.fn(), getEpicCogsAnalysis: vi.fn()
}));

vi.mock('./service.js', () => ({
  getVelocityForecast: vi.fn(),
  getEpicCompletionForecast: vi.fn(),
  getSlaRisk: vi.fn(),
  getAnomalies: vi.fn(),
  getRecommendations: vi.fn(),
  getCapacity: vi.fn(),
  getRoadmap: vi.fn(),
  getDependencies: vi.fn(),
  getExport: vi.fn()
}));

import { buildApp } from '../../app.js';
import * as intelSvc from './service.js';
import type { FastifyInstance } from 'fastify';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TENANT  = 'ten_test';
const EPIC_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const PROJ_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';

const makeVelocityResult = () => ({
  project_id: PROJ_ID,
  team_id: null,
  window_weeks: 12,
  forecastedPointsPerWeek: 18.5,
  weeklyHistory: [{ weekStart: '2026-03-30', points: 20 }],
  trend: 'stable',
  confidenceScore: 80
});

const makeEpicForecast = () => ({
  epic_id: EPIC_ID,
  epic_name: 'Auth Revamp',
  status: 'active',
  target_end_date: '2026-05-01',
  remaining_points: 40,
  velocity_forecast: { forecasted_points_per_week: 18.5, trend: 'stable', confidence_score: 80 },
  completion_forecast: { remainingPoints: 40, velocityPerWeek: 18.5, weeksRemaining: 3, estimatedEndDate: '2026-04-27' },
  weeks_overdue: 0
});

const makeSlaRisk = () => ([{
  instanceId: 'cccccccc-cccc-4ccc-cccc-cccccccccccc',
  taskId: 'dddddddd-dddd-4ddd-dddd-dddddddddddd',
  elapsedPercent: 75,
  riskScore: 75,
  riskLevel: 'high',
  hoursUntilDeadline: 6,
  deadlineAt: new Date().toISOString()
}]);

const makeAnomalies = () => ([{
  metric_name: 'deployment_frequency',
  project_id: null,
  anomalies: [{ date: '2026-03-05', value: 0.01, zScore: -2.5, direction: 'drop' }]
}]);

const makeRecommendations = () => ([{
  type: 'improve_deployment_frequency',
  priority: 'high',
  message: 'DORA level is low.',
  context: { doraLevel: 'low' }
}]);

const makeCapacity = () => ({
  period: '2026-04',
  team_id: null,
  capacity_hours_per_person: 160,
  total_users: 1,
  total_capacity_hours: 160,
  total_logged_hours: 120,
  overloaded_count: 0,
  utilization: [{ userId: 'user-1', hoursWorked: 120, capacityHours: 160, utilizationPercent: 75, status: 'normal' }]
});

const makeRoadmap = () => ([{
  project_id: PROJ_ID,
  project_name: 'Auth',
  project_key: 'AUTH',
  status: 'active',
  start_date: '2026-01-01',
  target_end_date: '2026-06-30',
  velocity_forecast: { forecasted_points_per_week: 18.5, trend: 'stable', confidence_score: 80 },
  epics: [{
    epic_id: EPIC_ID,
    epic_name: 'Auth Revamp',
    status: 'active',
    start_date: '2026-01-01',
    target_end_date: '2026-04-30',
    estimated_end_date: '2026-04-27',
    completion_percent: 60,
    total_story_points: 40,
    remaining_story_points: 16,
    is_delayed: false,
    weeks_overdue: 0,
    confidence_score: 80
  }]
}]);

const makeDependencies = () => ({
  nodes: [
    { task_id: 'dddddddd-dddd-4ddd-dddd-dddddddddddd', task_title: 'Setup DB', status: 'done', dependency_status: 'done', epic_id: EPIC_ID, assignee_id: null, story_points: 3, due_date: null },
    { task_id: 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee', task_title: 'Auth API', status: 'in_progress', dependency_status: 'ready', epic_id: EPIC_ID, assignee_id: null, story_points: 5, due_date: null }
  ],
  edges: [{ blocker_id: 'dddddddd-dddd-4ddd-dddd-dddddddddddd', blocked_id: 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee' }]
});

// ── Test suite ────────────────────────────────────────────────────────────────

describe('Intel routes', () => {
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

  // ── GET /intel/velocity/forecast ──────────────────────────────────────────

  describe('GET /api/v1/intel/velocity/forecast', () => {
    it('200: returns velocity forecast', async () => {
      vi.mocked(intelSvc.getVelocityForecast).mockResolvedValueOnce(makeVelocityResult() as any);
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/intel/velocity/forecast?project_id=${PROJ_ID}`,
        headers: { authorization: `Bearer ${token}` }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.forecastedPointsPerWeek).toBe(18.5);
    });

    it('401: no token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/intel/velocity/forecast' });
      expect(res.statusCode).toBe(401);
    });

    it('400: invalid window_weeks', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/intel/velocity/forecast?window_weeks=2',
        headers: { authorization: `Bearer ${token}` }
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /intel/epics/:epic_id/forecast ────────────────────────────────────

  describe('GET /api/v1/intel/epics/:epic_id/forecast', () => {
    it('200: returns epic forecast', async () => {
      vi.mocked(intelSvc.getEpicCompletionForecast).mockResolvedValueOnce(makeEpicForecast() as any);
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/intel/epics/${EPIC_ID}/forecast`,
        headers: { authorization: `Bearer ${token}` }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.epic_id).toBe(EPIC_ID);
    });

    it('404: epic not found', async () => {
      vi.mocked(intelSvc.getEpicCompletionForecast).mockResolvedValueOnce(null);
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/intel/epics/${EPIC_ID}/forecast`,
        headers: { authorization: `Bearer ${token}` }
      });
      expect(res.statusCode).toBe(404);
    });

    it('401: no token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/intel/epics/${EPIC_ID}/forecast`
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── GET /intel/sla/risk ───────────────────────────────────────────────────

  describe('GET /api/v1/intel/sla/risk', () => {
    it('200: returns risk list', async () => {
      vi.mocked(intelSvc.getSlaRisk).mockResolvedValueOnce(makeSlaRisk() as any);
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/intel/sla/risk',
        headers: { authorization: `Bearer ${token}` }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(1);
      expect(res.json().data[0].riskLevel).toBe('high');
    });

    it('401: no token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/intel/sla/risk' });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── GET /intel/anomalies ──────────────────────────────────────────────────

  describe('GET /api/v1/intel/anomalies', () => {
    it('200: returns anomalies grouped by metric', async () => {
      vi.mocked(intelSvc.getAnomalies).mockResolvedValueOnce(makeAnomalies() as any);
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/intel/anomalies',
        headers: { authorization: `Bearer ${token}` }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data[0].metric_name).toBe('deployment_frequency');
    });

    it('401: no token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/intel/anomalies' });
      expect(res.statusCode).toBe(401);
    });

    it('400: z_threshold out of range', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/intel/anomalies?z_threshold=0.5',
        headers: { authorization: `Bearer ${token}` }
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /intel/recommendations ────────────────────────────────────────────

  describe('GET /api/v1/intel/recommendations', () => {
    it('200: returns recommendations list', async () => {
      vi.mocked(intelSvc.getRecommendations).mockResolvedValueOnce(makeRecommendations() as any);
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/intel/recommendations',
        headers: { authorization: `Bearer ${token}` }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data[0].type).toBe('improve_deployment_frequency');
    });

    it('401: no token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/intel/recommendations' });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── GET /intel/capacity ───────────────────────────────────────────────────

  describe('GET /api/v1/intel/capacity', () => {
    it('200: returns capacity utilization', async () => {
      vi.mocked(intelSvc.getCapacity).mockResolvedValueOnce(makeCapacity() as any);
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/intel/capacity?period=2026-04',
        headers: { authorization: `Bearer ${token}` }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.period).toBe('2026-04');
      expect(res.json().data.utilization).toHaveLength(1);
    });

    it('400: missing period', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/intel/capacity',
        headers: { authorization: `Bearer ${token}` }
      });
      expect(res.statusCode).toBe(400);
    });

    it('400: invalid period format', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/intel/capacity?period=April2026',
        headers: { authorization: `Bearer ${token}` }
      });
      expect(res.statusCode).toBe(400);
    });

    it('401: no token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/intel/capacity?period=2026-04'
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── GET /intel/roadmap ────────────────────────────────────────────────────

  describe('GET /api/v1/intel/roadmap', () => {
    it('200: returns roadmap with projects and epics', async () => {
      vi.mocked(intelSvc.getRoadmap).mockResolvedValueOnce(makeRoadmap() as any);
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/intel/roadmap?project_id=${PROJ_ID}`,
        headers: { authorization: `Bearer ${token}` }
      });
      expect(res.statusCode).toBe(200);
      const data = res.json().data;
      expect(data).toHaveLength(1);
      expect(data[0].project_id).toBe(PROJ_ID);
      expect(data[0].epics).toHaveLength(1);
      expect(data[0].epics[0].completion_percent).toBe(60);
    });

    it('200: accepts epic status filter', async () => {
      vi.mocked(intelSvc.getRoadmap).mockResolvedValueOnce([] as any);
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/intel/roadmap?status=active',
        headers: { authorization: `Bearer ${token}` }
      });
      expect(res.statusCode).toBe(200);
    });

    it('400: invalid status value', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/intel/roadmap?status=unknown',
        headers: { authorization: `Bearer ${token}` }
      });
      expect(res.statusCode).toBe(400);
    });

    it('401: no token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/intel/roadmap' });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── GET /intel/dependencies ───────────────────────────────────────────────

  describe('GET /api/v1/intel/dependencies', () => {
    it('200: returns nodes and edges graph', async () => {
      vi.mocked(intelSvc.getDependencies).mockResolvedValueOnce(makeDependencies() as any);
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/intel/dependencies?epic_id=${EPIC_ID}`,
        headers: { authorization: `Bearer ${token}` }
      });
      expect(res.statusCode).toBe(200);
      const data = res.json().data;
      expect(data.nodes).toHaveLength(2);
      expect(data.edges).toHaveLength(1);
      expect(data.nodes.find((n: any) => n.dependency_status === 'done')).toBeTruthy();
    });

    it('200: accepts project_id filter', async () => {
      vi.mocked(intelSvc.getDependencies).mockResolvedValueOnce({ nodes: [], edges: [] } as any);
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/intel/dependencies?project_id=${PROJ_ID}`,
        headers: { authorization: `Bearer ${token}` }
      });
      expect(res.statusCode).toBe(200);
    });

    it('401: no token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/intel/dependencies' });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── GET /intel/export ─────────────────────────────────────────────────────

  describe('GET /api/v1/intel/export', () => {
    it('200: returns CSV with correct content-type for tasks', async () => {
      vi.mocked(intelSvc.getExport).mockResolvedValueOnce('id,title\nt1,Fix bug' as any);
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/intel/export?type=tasks',
        headers: { authorization: `Bearer ${token}` }
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['content-disposition']).toMatch(/attachment/);
      expect(res.payload).toContain('id,title');
    });

    it('200: returns CSV for epics', async () => {
      vi.mocked(intelSvc.getExport).mockResolvedValueOnce('id,name\ne1,Auth' as any);
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/intel/export?type=epics',
        headers: { authorization: `Bearer ${token}` }
      });
      expect(res.statusCode).toBe(200);
    });

    it('400: missing required type param', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/intel/export',
        headers: { authorization: `Bearer ${token}` }
      });
      expect(res.statusCode).toBe(400);
    });

    it('400: invalid type value', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/intel/export?type=unknown',
        headers: { authorization: `Bearer ${token}` }
      });
      expect(res.statusCode).toBe(400);
    });

    it('401: no token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/intel/export?type=tasks' });
      expect(res.statusCode).toBe(401);
    });
  });
});
