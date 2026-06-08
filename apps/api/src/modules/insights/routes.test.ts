import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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

vi.mock('../../modules/billing/entitlement.js', () => ({
  requireModule: () => async () => {},
  requireFeature: () => async () => {},
  loadEntitlement: vi.fn(),
  invalidateEntitlementCache: vi.fn()
}));

vi.mock('./service.js', () => ({
  getInsightsOverviewByResourceGroup: vi.fn(),
  getIncidentInsightsByResourceGroup: vi.fn(),
  getPlanningConfidenceByResourceGroup: vi.fn(),
  getBacklogQualityByResourceGroup: vi.fn(),
  getInsightTrendsByResourceGroup: vi.fn(),
  recomputeInsightsForResourceGroup: vi.fn()
}));

vi.mock('./policy.service.js', () => ({
  getActiveCalculationPolicyForResourceGroup: vi.fn(),
  listCalculationPolicyMappingCandidatesForResourceGroup: vi.fn(),
  createDraftCalculationPolicy: vi.fn(),
  publishDraftCalculationPolicy: vi.fn(),
  listCalculationPolicyHistory: vi.fn()
}));

import { buildApp } from '../../app.js';
import * as svc from './service.js';
import * as policySvc from './policy.service.js';
import type { FastifyInstance } from 'fastify';

const TENANT = 'ten_test';
const GROUP_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';

describe('Insights routes', () => {
  let app: FastifyInstance;
  let fullToken: string;
  let missingPermissionToken: string;
  let policyToken: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-do-not-use-in-production';
    process.env.AUTH_BYPASS = 'false';

    app = buildApp();
    await app.ready();

    fullToken = app.jwt.sign({
      sub: 'user-1',
      tenant_id: TENANT,
      roles: ['manager'],
      permissions: ['insights.read', 'insights.recompute']
    });

    missingPermissionToken = app.jwt.sign({
      sub: 'user-2',
      tenant_id: TENANT,
      roles: ['viewer'],
      permissions: ['resource_group.read']
    });

    policyToken = app.jwt.sign({
      sub: 'user-5',
      tenant_id: TENANT,
      roles: ['manager'],
      permissions: ['insights.policy.read', 'insights.policy.write', 'insights.policy.publish']
    });
  });

  afterAll(() => app.close());

  describe('GET /api/v1/insights/resource-groups/:group_id/overview', () => {
    it('200: retorna overview por grupo', async () => {
      vi.mocked(svc.getInsightsOverviewByResourceGroup).mockResolvedValueOnce({
        resource_group: { id: GROUP_ID, key: 'payments-platform', name: 'Payments Platform' },
        period: {
          window_days: 30,
          from: '2026-05-06T00:00:00.000Z',
          to: '2026-06-05T23:59:59.999Z'
        },
        health_score: 74,
        risk_level: 'watch',
        drivers: ['incident_load'],
        execution: { throughput_7d: 42, throughput_30d: 160, trend: 'down' },
        incident: {
          incident_count_7d: 6,
          incident_count_30d: 18,
          mtta_p50_minutes: 18,
          mttr_p50_hours: 3.4,
          mttr_source: 'incidents'
        },
        recommendations: [],
        warnings: []
      } as any);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/overview?window_days=30`,
        headers: { authorization: `Bearer ${fullToken}` }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.resource_group.id).toBe(GROUP_ID);
    });

    it('400: query invalida', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/overview?window_days=999`,
        headers: { authorization: `Bearer ${fullToken}` }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('BAD_REQUEST');
    });

    it('403: sem permissao', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/overview`,
        headers: { authorization: `Bearer ${missingPermissionToken}` }
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
    });

    it('404: grupo inexistente', async () => {
      vi.mocked(svc.getInsightsOverviewByResourceGroup).mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/overview`,
        headers: { authorization: `Bearer ${fullToken}` }
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });
  });

  describe('GET /api/v1/insights/resource-groups/:group_id/incidents', () => {
    it('200: retorna incident insights por grupo', async () => {
      vi.mocked(svc.getIncidentInsightsByResourceGroup).mockResolvedValueOnce({
        resource_group: { id: GROUP_ID, key: 'payments-platform', name: 'Payments Platform' },
        period: '2026-06',
        total_incidents: 18,
        severity_distribution: [{ severity: 'P1', count: 4 }],
        hotspot_services: [{ service: 'checkout-api', count: 9 }],
        mtta_p50_minutes: 18,
        mttr_p50_hours: 3.4,
        warnings: []
      } as any);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/incidents?period=2026-06`,
        headers: { authorization: `Bearer ${fullToken}` }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.total_incidents).toBe(18);
    });

    it('400: period invalido', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/incidents?period=2026/06`,
        headers: { authorization: `Bearer ${fullToken}` }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('BAD_REQUEST');
    });

    it('401: sem token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/incidents`
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/insights/resource-groups/:group_id/planning-confidence', () => {
    it('200: retorna planning confidence', async () => {
      vi.mocked(svc.getPlanningConfidenceByResourceGroup).mockResolvedValueOnce({
        resource_group: { id: GROUP_ID, key: 'payments-platform', name: 'Payments Platform' },
        period: '2026-06',
        planning_confidence: {
          score: 68,
          level: 'watch',
          trend: 'down',
          drivers: ['scope_drift', 'backlog_staleness']
        },
        roadmap_confidence: {
          score: 64,
          trend: 'down',
          on_track_ratio: 0.57,
          delayed_epics_count: 2
        },
        epics: [
          {
            epic_id: 'epic-1',
            epic_name: 'Checkout Revamp',
            confidence_score: 52,
            confidence_level: 'low',
            weeks_overdue: 2,
            drivers: ['schedule_drift']
          }
        ],
        incident_correlation: {
          impacted_epics_count: 1,
          roadmap_risk_due_to_incidents: 'medium'
        },
        warnings: []
      } as any);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/planning-confidence?period=2026-06`,
        headers: { authorization: `Bearer ${fullToken}` }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.planning_confidence.score).toBe(68);
    });

    it('400: query invalida', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/planning-confidence?period=2026/06`,
        headers: { authorization: `Bearer ${fullToken}` }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('BAD_REQUEST');
    });

    it('403: sem permissao', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/planning-confidence`,
        headers: { authorization: `Bearer ${missingPermissionToken}` }
      });

      expect(res.statusCode).toBe(403);
    });

    it('404: grupo nao encontrado', async () => {
      vi.mocked(svc.getPlanningConfidenceByResourceGroup).mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/planning-confidence`,
        headers: { authorization: `Bearer ${fullToken}` }
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/v1/insights/resource-groups/:group_id/backlog-quality', () => {
    it('200: retorna backlog quality', async () => {
      vi.mocked(svc.getBacklogQualityByResourceGroup).mockResolvedValueOnce({
        resource_group: { id: GROUP_ID, key: 'payments-platform', name: 'Payments Platform' },
        backlog_quality: {
          score: 61,
          level: 'watch',
          backlog_aging_index_days: 34,
          stale_backlog_rate: 0.31,
          overdue_backlog_rate: 0.18,
          flow_regression_rate: 0.11,
          backlog_churn_proxy: 0.27
        },
        thresholds: { stale_days: 21 },
        warnings: []
      } as any);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/backlog-quality?stale_days=21`,
        headers: { authorization: `Bearer ${fullToken}` }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.backlog_quality.score).toBe(61);
    });

    it('400: stale_days invalido', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/backlog-quality?stale_days=2`,
        headers: { authorization: `Bearer ${fullToken}` }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('BAD_REQUEST');
    });

    it('403: sem permissao', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/backlog-quality`,
        headers: { authorization: `Bearer ${missingPermissionToken}` }
      });

      expect(res.statusCode).toBe(403);
    });

    it('404: grupo nao encontrado', async () => {
      vi.mocked(svc.getBacklogQualityByResourceGroup).mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/backlog-quality`,
        headers: { authorization: `Bearer ${fullToken}` }
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/v1/insights/resource-groups/:group_id/trends', () => {
    it('200: retorna trends por grupo', async () => {
      vi.mocked(svc.getInsightTrendsByResourceGroup).mockResolvedValueOnce({
        resource_group: { id: GROUP_ID, key: 'payments-platform', name: 'Payments Platform' },
        window_days: 60,
        granularity: 'weekly',
        series: {
          throughput: [{ bucket: '2026-05-01', value: 24 }],
          incidents: [{ bucket: '2026-05-01', value: 3 }],
          confidence: [{ bucket: '2026-05-01', value: 68 }]
        },
        anomalies: [],
        degradation_signals: [],
        warnings: []
      } as any);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/trends?window_days=60&granularity=weekly`,
        headers: { authorization: `Bearer ${fullToken}` }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.window_days).toBe(60);
    });

    it('400: granularity invalida', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/trends?window_days=60&granularity=monthly`,
        headers: { authorization: `Bearer ${fullToken}` }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('BAD_REQUEST');
    });

    it('403: sem permissao', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/trends`,
        headers: { authorization: `Bearer ${missingPermissionToken}` }
      });

      expect(res.statusCode).toBe(403);
    });

    it('404: grupo nao encontrado', async () => {
      vi.mocked(svc.getInsightTrendsByResourceGroup).mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/trends`,
        headers: { authorization: `Bearer ${fullToken}` }
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/v1/insights/resource-groups/:group_id/recompute', () => {
    it('202: aceita recompute', async () => {
      vi.mocked(svc.recomputeInsightsForResourceGroup).mockResolvedValueOnce({
        job_id: 'job-1',
        status: 'queued',
        resource_group_id: GROUP_ID,
        submitted_at: '2026-06-05T18:00:00.000Z'
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/recompute`,
        headers: { authorization: `Bearer ${fullToken}` },
        body: { mode: 'full', reason: 'manual_refresh' }
      });

      expect(res.statusCode).toBe(202);
      expect(res.json().data.status).toBe('queued');
    });

    it('400: body invalido', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/recompute`,
        headers: { authorization: `Bearer ${fullToken}` },
        body: { mode: 'invalid' }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('BAD_REQUEST');
    });

    it('403: sem permissao', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/recompute`,
        headers: { authorization: `Bearer ${missingPermissionToken}` },
        body: { mode: 'incremental' }
      });

      expect(res.statusCode).toBe(403);
    });

    it('409: recompute em andamento', async () => {
      vi.mocked(svc.recomputeInsightsForResourceGroup).mockResolvedValueOnce({ error: 'JOB_IN_PROGRESS' } as any);

      const limitedToken = app.jwt.sign({
        sub: 'user-3',
        tenant_id: TENANT,
        roles: ['manager'],
        permissions: ['insights.recompute']
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/recompute`,
        headers: { authorization: `Bearer ${limitedToken}` },
        body: { mode: 'incremental' }
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('CONFLICT');
    });

    it('404: grupo nao encontrado', async () => {
      vi.mocked(svc.recomputeInsightsForResourceGroup).mockResolvedValueOnce(null);

      const limitedToken = app.jwt.sign({
        sub: 'user-4',
        tenant_id: TENANT,
        roles: ['manager'],
        permissions: ['insights.recompute']
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/recompute`,
        headers: { authorization: `Bearer ${limitedToken}` },
        body: { mode: 'incremental' }
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });
  });

  describe('GET /api/v1/insights/resource-groups/:group_id/calculation-policy', () => {
    it('200: retorna policy ativa resolvida', async () => {
      vi.mocked(policySvc.getActiveCalculationPolicyForResourceGroup).mockResolvedValueOnce({
        resource_group_id: GROUP_ID,
        policy_source: 'resource_group',
        policy: {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Payments custom policy',
          status: 'active',
          version: 3,
          effective_from: '2026-06-08T10:00:00.000Z',
          effective_to: null,
          config: { state_mapping: {}, delivery: { sources: ['task_done'], aggregation_mode: 'single' } },
          created_at: '2026-06-08T10:00:00.000Z',
          updated_at: '2026-06-08T10:00:00.000Z'
        }
      } as any);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/calculation-policy`,
        headers: { authorization: `Bearer ${policyToken}` }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.policy_source).toBe('resource_group');
    });

    it('400: query invalida', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/calculation-policy?at=invalid-date`,
        headers: { authorization: `Bearer ${policyToken}` }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('BAD_REQUEST');
    });

    it('403: sem permissao', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/calculation-policy`,
        headers: { authorization: `Bearer ${fullToken}` }
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
    });
  });

  describe('PUT /api/v1/insights/resource-groups/:group_id/calculation-policy', () => {
    it('201: cria draft', async () => {
      vi.mocked(policySvc.createDraftCalculationPolicy).mockResolvedValueOnce({
        data: {
          id: '22222222-2222-4222-8222-222222222222',
          resource_group_id: GROUP_ID,
          name: 'Draft policy',
          status: 'draft',
          version: 4,
          effective_from: null,
          effective_to: null,
          created_by: 'user-5',
          updated_by: 'user-5',
          created_at: '2026-06-08T11:00:00.000Z',
          updated_at: '2026-06-08T11:00:00.000Z',
          config: {
            state_mapping: {
              backlog: [{ provider: 'jira', source_type: 'issue', match: 'To Do' }],
              planned: [],
              in_progress: [],
              paused: [],
              done: [{ provider: 'jira', source_type: 'issue', match: 'Done' }],
              cancelled: []
            },
            delivery: {
              sources: ['task_done'],
              aggregation_mode: 'single',
              dedup: { enabled: true, key_strategy: 'task_source_or_pr_or_release' }
            }
          }
        }
      } as any);

      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/calculation-policy`,
        headers: { authorization: `Bearer ${policyToken}` },
        body: {
          name: 'Draft policy',
          config: {
            state_mapping: {
              backlog: [{ provider: 'jira', source_type: 'issue', match: 'To Do' }],
              planned: [],
              in_progress: [],
              paused: [],
              done: [{ provider: 'jira', source_type: 'issue', match: 'Done' }],
              cancelled: []
            },
            delivery: {
              sources: ['task_done'],
              aggregation_mode: 'single'
            }
          }
        }
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().data.status).toBe('draft');
    });

    it('400: body invalido', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/calculation-policy`,
        headers: { authorization: `Bearer ${policyToken}` },
        body: {
          name: 'x',
          config: {}
        }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('BAD_REQUEST');
    });
  });

  describe('GET /api/v1/insights/resource-groups/:group_id/calculation-policy/candidates', () => {
    it('200: retorna candidatos de mapping para multiselect', async () => {
      vi.mocked(policySvc.listCalculationPolicyMappingCandidatesForResourceGroup).mockResolvedValueOnce({
        resource_group_id: GROUP_ID,
        items: [
          { provider: 'jira', source_type: 'task_status', match: 'todo' },
          { provider: 'jira', source_type: 'task_status', match: 'in_progress' },
          { provider: 'github', source_type: 'task_status', match: 'done' }
        ],
        defaults: {
          task_statuses: ['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled']
        }
      } as any);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/calculation-policy/candidates`,
        headers: { authorization: `Bearer ${policyToken}` }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.items).toHaveLength(3);
      expect(res.json().data.defaults.task_statuses).toContain('done');
    });

    it('403: sem permissao', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/calculation-policy/candidates`,
        headers: { authorization: `Bearer ${fullToken}` }
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
    });

    it('404: resource group inexistente', async () => {
      vi.mocked(policySvc.listCalculationPolicyMappingCandidatesForResourceGroup).mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/calculation-policy/candidates`,
        headers: { authorization: `Bearer ${policyToken}` }
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /api/v1/insights/resource-groups/:group_id/calculation-policy/publish', () => {
    it('200: publica draft', async () => {
      vi.mocked(policySvc.publishDraftCalculationPolicy).mockResolvedValueOnce({
        data: {
          id: '22222222-2222-4222-8222-222222222222',
          resource_group_id: GROUP_ID,
          name: 'Draft policy',
          status: 'active',
          version: 4,
          effective_from: '2026-06-08T11:30:00.000Z',
          effective_to: null,
          created_by: 'user-5',
          updated_by: 'user-5',
          created_at: '2026-06-08T11:00:00.000Z',
          updated_at: '2026-06-08T11:30:00.000Z',
          config: {
            state_mapping: {},
            delivery: {
              sources: ['task_done'],
              aggregation_mode: 'single'
            }
          }
        }
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/calculation-policy/publish`,
        headers: { authorization: `Bearer ${policyToken}` },
        body: {
          draft_id: '22222222-2222-4222-8222-222222222222'
        }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe('active');
    });

    it('409: conflito com policy ativa', async () => {
      vi.mocked(policySvc.publishDraftCalculationPolicy).mockResolvedValueOnce({
        error: 'ACTIVE_POLICY_CONFLICT',
        conflictPolicyId: '33333333-3333-4333-8333-333333333333'
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/calculation-policy/publish`,
        headers: { authorization: `Bearer ${policyToken}` },
        body: {
          draft_id: '22222222-2222-4222-8222-222222222222'
        }
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('CONFLICT');
    });
  });

  describe('GET /api/v1/insights/resource-groups/:group_id/calculation-policy/history', () => {
    it('200: retorna historico', async () => {
      vi.mocked(policySvc.listCalculationPolicyHistory).mockResolvedValueOnce({
        resource_group_id: GROUP_ID,
        items: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            resource_group_id: GROUP_ID,
            name: 'Draft policy',
            status: 'active',
            version: 4,
            effective_from: '2026-06-08T11:30:00.000Z',
            effective_to: null,
            created_by: 'user-5',
            updated_by: 'user-5',
            created_at: '2026-06-08T11:00:00.000Z',
            updated_at: '2026-06-08T11:30:00.000Z'
          }
        ]
      } as any);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/calculation-policy/history?limit=10`,
        headers: { authorization: `Bearer ${policyToken}` }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.items).toHaveLength(1);
    });

    it('400: query invalida', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/insights/resource-groups/${GROUP_ID}/calculation-policy/history?limit=1000`,
        headers: { authorization: `Bearer ${policyToken}` }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('BAD_REQUEST');
    });
  });
});
