import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TEST_TEMPLATE_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const TEST_TASK_ID     = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';

// ── Mock worker + all service layers (must precede imports) ──────────────────

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

vi.mock('./service.js', () => ({
  createSlaTemplate: vi.fn(),
  listSlaTemplates: vi.fn(),
  getSlaTemplate: vi.fn(),
  updateSlaTemplate: vi.fn(),
  deleteSlaTemplate: vi.fn(),
  getSlaCompliance: vi.fn()
}));

import { buildApp } from '../../app.js';
import * as slaSvc from './service.js';
import type { FastifyInstance } from 'fastify';

// ── Shared condition fixture ──────────────────────────────────────────────────

const CONDITION = {
  operator: 'AND',
  rules: [{ field: 'task_type', op: 'in', value: ['bug'] }]
};

const RULES = {
  P0: { target_minutes: 120, warning_at_percent: 80 },
  P1: { target_minutes: 480, warning_at_percent: 80 }
};

function makeTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_TEMPLATE_ID,
    tenantId: 'ten_test',
    name: 'Bug SLA',
    description: null,
    condition: CONDITION,
    priority: 10,
    appliesTo: ['bug'],
    rules: RULES,
    escalationRule: null,
    projectIds: [],
    isDefault: false,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('SLA routes', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    process.env['AUTH_BYPASS'] = 'false';
    app = buildApp();
    await app.ready();
    token = app.jwt.sign({
      sub: 'user-1',
      tenant_id: 'ten_test',
      roles: ['admin'],
      permissions: ['*']
    });
  });

  afterAll(() => app.close());

  // ── POST /sla/templates ────────────────────────────────────────────────────

  describe('POST /api/v1/sla/templates', () => {
    it('201: creates template', async () => {
      vi.mocked(slaSvc.createSlaTemplate).mockResolvedValueOnce(makeTemplate());

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sla/templates',
        headers: { authorization: `Bearer ${token}` },
        body: {
          name: 'Bug SLA',
          condition: CONDITION,
          applies_to: ['bug'],
          rules: RULES
        }
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().data.id).toBe(TEST_TEMPLATE_ID);
      expect(slaSvc.createSlaTemplate).toHaveBeenCalledWith('ten_test', expect.any(Object));
    });

    it('400: missing required fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sla/templates',
        headers: { authorization: `Bearer ${token}` },
        body: { name: 'Bad' } // missing condition, applies_to, rules
      });
      expect(res.statusCode).toBe(400);
    });

    it('401: no token', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/sla/templates', body: {} });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── GET /sla/templates ─────────────────────────────────────────────────────

  describe('GET /api/v1/sla/templates', () => {
    it('200: returns list', async () => {
      vi.mocked(slaSvc.listSlaTemplates).mockResolvedValueOnce({
        data: [makeTemplate()],
        next_cursor: null
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/sla/templates',
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.data).toHaveLength(1);
      expect(res.json().data.next_cursor).toBeNull();
    });

    it('200: filters by is_active', async () => {
      vi.mocked(slaSvc.listSlaTemplates).mockResolvedValueOnce({ data: [], next_cursor: null });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/sla/templates?is_active=true',
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.statusCode).toBe(200);
      expect(slaSvc.listSlaTemplates).toHaveBeenCalledWith(
        'ten_test',
        expect.objectContaining({ is_active: true })
      );
    });
  });

  // ── GET /sla/templates/:id ─────────────────────────────────────────────────

  describe('GET /api/v1/sla/templates/:id', () => {
    it('200: returns template', async () => {
      vi.mocked(slaSvc.getSlaTemplate).mockResolvedValueOnce(makeTemplate());

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/sla/templates/${TEST_TEMPLATE_ID}`,
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.id).toBe(TEST_TEMPLATE_ID);
    });

    it('404: template not found', async () => {
      vi.mocked(slaSvc.getSlaTemplate).mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/sla/templates/${TEST_TEMPLATE_ID}`,
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── PATCH /sla/templates/:id ───────────────────────────────────────────────

  describe('PATCH /api/v1/sla/templates/:id', () => {
    it('200: updates template', async () => {
      vi.mocked(slaSvc.updateSlaTemplate).mockResolvedValueOnce(
        makeTemplate({ name: 'Updated SLA' })
      );

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/sla/templates/${TEST_TEMPLATE_ID}`,
        headers: { authorization: `Bearer ${token}` },
        body: { name: 'Updated SLA' }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.name).toBe('Updated SLA');
    });

    it('404: template not found', async () => {
      vi.mocked(slaSvc.updateSlaTemplate).mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/sla/templates/${TEST_TEMPLATE_ID}`,
        headers: { authorization: `Bearer ${token}` },
        body: { name: 'x' }
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── DELETE /sla/templates/:id ──────────────────────────────────────────────

  describe('DELETE /api/v1/sla/templates/:id', () => {
    it('204: deletes template', async () => {
      vi.mocked(slaSvc.deleteSlaTemplate).mockResolvedValueOnce(true);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/sla/templates/${TEST_TEMPLATE_ID}`,
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.statusCode).toBe(204);
    });

    it('404: template not found', async () => {
      vi.mocked(slaSvc.deleteSlaTemplate).mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/sla/templates/${TEST_TEMPLATE_ID}`,
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── GET /sla/compliance ────────────────────────────────────────────────────

  describe('GET /api/v1/sla/compliance', () => {
    it('200: returns compliance result', async () => {
      vi.mocked(slaSvc.getSlaCompliance).mockResolvedValueOnce({
        period: { from: '2026-04-01T00:00:00.000Z', to: '2026-04-30T23:59:59.000Z' },
        templates: []
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/sla/compliance?from=2026-04-01T00:00:00Z&to=2026-04-30T23:59:59Z',
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.templates).toEqual([]);
    });

    it('400: missing required from/to', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/sla/compliance',
        headers: { authorization: `Bearer ${token}` }
      });
      expect(res.statusCode).toBe(400);
    });

    it('401: no token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/sla/compliance?from=2026-04-01T00:00:00Z&to=2026-04-30T23:59:59Z'
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
