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
  createResourceGroup: vi.fn(),
  listResourceGroups: vi.fn(),
  getResourceGroup: vi.fn(),
  updateResourceGroup: vi.fn(),
  addResourceToGroup: vi.fn(),
  removeResourceFromGroup: vi.fn(),
  addTeamToGroup: vi.fn(),
  removeTeamFromGroup: vi.fn(),
  getResourceGroupMetricsSummary: vi.fn()
}));

import { buildApp } from '../../app.js';
import * as svc from './service.js';
import type { FastifyInstance } from 'fastify';

const GROUP_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const TEAM_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const PROJECT_ID = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';

function makeGroup(overrides: Record<string, unknown> = {}) {
  return {
    id: GROUP_ID,
    tenantId: 'ten_test',
    key: 'core-platform',
    name: 'Core Platform',
    description: null,
    status: 'planning',
    ownerUserId: null,
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    _count: { resources: 1, teams: 1 },
    resources: [],
    teams: [],
    ...overrides
  };
}

describe('Resource Groups routes', () => {
  let app: FastifyInstance;
  let fullToken: string;
  let readOnlyToken: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-do-not-use-in-production';
    process.env.AUTH_BYPASS = 'false';

    app = buildApp();
    await app.ready();

    fullToken = app.jwt.sign({
      sub: 'user-1',
      tenant_id: 'ten_test',
      roles: ['manager'],
      permissions: ['resource_group.read', 'resource_group.manage', 'resource_group.metrics.read']
    });

    readOnlyToken = app.jwt.sign({
      sub: 'user-2',
      tenant_id: 'ten_test',
      roles: ['viewer'],
      permissions: ['resource_group.read']
    });
  });

  afterAll(() => app.close());

  describe('GET /api/v1/resource-groups', () => {
    it('200: lista grupos paginada', async () => {
      vi.mocked(svc.listResourceGroups).mockResolvedValueOnce({
        items: [makeGroup()] as any,
        nextCursor: null
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/resource-groups?limit=50',
        headers: { authorization: `Bearer ${fullToken}` }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0].id).toBe(GROUP_ID);
    });

    it('400: query invalida', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/resource-groups?limit=999',
        headers: { authorization: `Bearer ${fullToken}` }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('BAD_REQUEST');
    });

    it('401: sem token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/resource-groups'
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /api/v1/resource-groups', () => {
    it('201: cria grupo', async () => {
      vi.mocked(svc.createResourceGroup).mockResolvedValueOnce(makeGroup() as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/resource-groups',
        headers: { authorization: `Bearer ${fullToken}` },
        body: {
          key: 'core-platform',
          name: 'Core Platform'
        }
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().data.key).toBe('core-platform');
    });

    it('400: body invalido', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/resource-groups',
        headers: { authorization: `Bearer ${fullToken}` },
        body: {
          name: 'Sem key'
        }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('BAD_REQUEST');
    });

    it('403: sem permissao de manage', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/resource-groups',
        headers: { authorization: `Bearer ${readOnlyToken}` },
        body: {
          key: 'core-platform',
          name: 'Core Platform'
        }
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('POST /api/v1/resource-groups/:group_id/resources', () => {
    it('200: vincula recurso', async () => {
      vi.mocked(svc.addResourceToGroup).mockResolvedValueOnce({
        data: {
          resourceGroupId: GROUP_ID,
          projectId: PROJECT_ID,
          role: 'shared',
          weightMode: 'auto',
          manualWeight: null,
          createdAt: new Date()
        }
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resource-groups/${GROUP_ID}/resources`,
        headers: { authorization: `Bearer ${fullToken}` },
        body: { project_id: PROJECT_ID }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.project_id).toBe(PROJECT_ID);
    });

    it('400: manual_weight obrigatorio quando weight_mode=manual', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/resource-groups/${GROUP_ID}/resources`,
        headers: { authorization: `Bearer ${fullToken}` },
        body: { project_id: PROJECT_ID, weight_mode: 'manual' }
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('BAD_REQUEST');
    });
  });

  describe('GET /api/v1/resource-groups/:group_id/metrics/summary', () => {
    it('200: retorna summary', async () => {
      vi.mocked(svc.getResourceGroupMetricsSummary).mockResolvedValueOnce({
        resource_group_id: GROUP_ID,
        resources_count: 1,
        teams_count: 1,
        providers_breakdown: { jira: 1 },
        weight_mode_breakdown: { auto: 1 },
        manual_overrides_count: 0,
        generated_at: new Date().toISOString()
      } as any);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/resource-groups/${GROUP_ID}/metrics/summary`,
        headers: { authorization: `Bearer ${fullToken}` }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.resource_group_id).toBe(GROUP_ID);
    });

    it('404: grupo nao encontrado no summary', async () => {
      vi.mocked(svc.getResourceGroupMetricsSummary).mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/resource-groups/${GROUP_ID}/metrics/summary`,
        headers: { authorization: `Bearer ${fullToken}` }
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });

    it('403: sem permissao de metrics.read', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/resource-groups/${GROUP_ID}/metrics/summary`,
        headers: { authorization: `Bearer ${readOnlyToken}` }
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('DELETE /api/v1/resource-groups/:group_id/teams/:team_id', () => {
    it('204: remove vinculo de time', async () => {
      vi.mocked(svc.removeTeamFromGroup).mockResolvedValueOnce(true);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/resource-groups/${GROUP_ID}/teams/${TEAM_ID}`,
        headers: { authorization: `Bearer ${fullToken}` }
      });

      expect(res.statusCode).toBe(204);
    });
  });
});
