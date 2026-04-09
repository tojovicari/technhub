import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Valid UUIDs used across tests
const TEST_PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const TEST_EPIC_ID    = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const TEST_USER_ID    = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
const TEST_TEAM_ID    = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';

// ── Mock worker + service layer ───────────────────────────────────────────────
// vi.mock is hoisted — these run before any imports below

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

import { buildApp } from '../../app.js';
import * as svc from '../../modules/core/service.js';
import type { FastifyInstance } from 'fastify';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_PROJECT_ID,
    tenantId: 'ten_test',
    key: 'TST',
    name: 'Test Project',
    teamId: null,
    status: 'planning',
    startDate: null,
    targetEndDate: null,
    syncConfig: null,
    customFields: null,
    tags: [],
    team: null,
    epics: [],
    tasks: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_EPIC_ID,
    tenantId: 'ten_test',
    source: 'manual',
    sourceId: null,
    projectId: TEST_PROJECT_ID,
    epicId: null,
    title: 'Test task',
    description: null,
    taskType: 'feature',
    priority: 'P2',
    status: 'backlog',
    assigneeId: null,
    reporterId: null,
    storyPoints: null,
    hoursEstimated: null,
    hoursActual: null,
    startedAt: null,
    completedAt: null,
    dueDate: null,
    slaStatus: 'n_a',
    cycleTimeHours: null,
    relatedPrIds: [],
    tags: [],
    customFields: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_USER_ID,
    tenantId: 'ten_test',
    email: 'alice@example.com',
    fullName: 'Alice',
    role: 'engineer',
    isActive: true,
    createdAt: new Date(),
    ...overrides
  };
}

// ── Test setup ────────────────────────────────────────────────────────────────

describe('Core routes', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    delete process.env.AUTH_BYPASS;
    process.env.JWT_SECRET = 'test-secret-do-not-use-in-production';
    app = buildApp();
    await app.ready();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    token = (app as any).jwt.sign({
      sub: 'usr_test',
      tenant_id: 'ten_test',
      roles: ['admin'],
      permissions: ['*']
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // ── POST /core/projects ──────────────────────────────────────────────────────

  describe('POST /api/v1/core/projects', () => {
    it('creates a project and returns 201', async () => {
      vi.mocked(svc.createProject).mockResolvedValueOnce(makeProject() as never);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/core/projects',
        headers: { authorization: `Bearer ${token}` },
        body: { tenant_id: 'ten_test', key: 'TST', name: 'Test Project' }
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.data.key).toBe('TST');
      expect(body.error).toBeNull();
    });

    it('returns 400 on invalid request body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/core/projects',
        headers: { authorization: `Bearer ${token}` },
        body: { tenant_id: 'ten_test' } // missing key and name
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe('BAD_REQUEST');
    });

    it('returns 401 when no token is provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/core/projects',
        body: { tenant_id: 'ten_test', key: 'TST', name: 'Test Project' }
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 403 when tenant_id in body differs from JWT', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/core/projects',
        headers: { authorization: `Bearer ${token}` },
        body: { tenant_id: 'ten_other', key: 'TST', name: 'Test Project' }
      });

      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error.details.reason).toBe('tenant_mismatch');
    });
  });

  // ── GET /core/projects/:id ──────────────────────────────────────────────────

  describe('GET /api/v1/core/projects/:project_id', () => {
    it('returns the project when found', async () => {
      vi.mocked(svc.getProject).mockResolvedValueOnce(makeProject() as never);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/core/projects/${TEST_PROJECT_ID}`,
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).data.id).toBe(TEST_PROJECT_ID);
    });

    it('returns 404 when project is not found', async () => {
      vi.mocked(svc.getProject).mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/core/projects/00000000-0000-0000-0000-000000000000`,
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error.code).toBe('NOT_FOUND');
    });
  });

  // ── GET /core/projects (list) ────────────────────────────────────────────────

  describe('GET /api/v1/core/projects', () => {
    it('returns paginated project list', async () => {
      vi.mocked(svc.listProjects).mockResolvedValueOnce({
        items: [makeProject()] as never,
        nextCursor: null
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/core/projects?limit=10',
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.items).toHaveLength(1);
      expect(body.data.next_cursor).toBeNull();
    });

    it('passes status filter to service', async () => {
      vi.mocked(svc.listProjects).mockResolvedValueOnce({ items: [] as never, nextCursor: null });

      await app.inject({
        method: 'GET',
        url: '/api/v1/core/projects?status=active',
        headers: { authorization: `Bearer ${token}` }
      });

      expect(svc.listProjects).toHaveBeenCalledWith(
        'ten_test',
        expect.objectContaining({ status: 'active' })
      );
    });

    it('returns 400 on invalid limit', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/core/projects?limit=9999',
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── POST /core/tasks ──────────────────────────────────────────────────────────

  describe('POST /api/v1/core/tasks', () => {
    it('creates a task and returns 201', async () => {
      vi.mocked(svc.createTask).mockResolvedValueOnce(makeTask({ status: 'in_progress', startedAt: new Date() }) as never);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/core/tasks',
        headers: { authorization: `Bearer ${token}` },
        body: {
          tenant_id: 'ten_test',
          project_id: TEST_PROJECT_ID,
          title: 'Implement auth',
          task_type: 'feature',
          status: 'in_progress'
        }
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.data.status).toBe('in_progress');
      expect(body.data.started_at).not.toBeNull();
    });

    it('returns 400 when task_type is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/core/tasks',
        headers: { authorization: `Bearer ${token}` },
        body: { tenant_id: 'ten_test', project_id: TEST_PROJECT_ID, title: 'X' }
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── PATCH /core/tasks/:id ─────────────────────────────────────────────────────

  describe('PATCH /api/v1/core/tasks/:task_id', () => {
    it('updates a task and returns 200 with new data', async () => {
      const completedAt = new Date();
      vi.mocked(svc.updateTask).mockResolvedValueOnce(makeTask({ status: 'done', completedAt, cycleTimeHours: 2.5 }) as never);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/core/tasks/${TEST_EPIC_ID}`,
        headers: { authorization: `Bearer ${token}` },
        body: { status: 'done', hours_actual: 2.5 }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.status).toBe('done');
      expect(body.data.completed_at).not.toBeNull();
      expect(body.data.cycle_time_hours).toBe(2.5);
    });

    it('returns 404 when task does not exist', async () => {
      vi.mocked(svc.updateTask).mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/core/tasks/00000000-0000-0000-0000-000000000000`,
        headers: { authorization: `Bearer ${token}` },
        body: { status: 'done' }
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── GET /core/tasks (list) ────────────────────────────────────────────────────

  describe('GET /api/v1/core/tasks', () => {
    it('returns filtered task list', async () => {
      vi.mocked(svc.listTasks).mockResolvedValueOnce({
        items: [makeTask({ status: 'done' })] as never,
        nextCursor: 'task-cursor'
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/core/tasks?status=done&limit=5',
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.items).toHaveLength(1);
      expect(body.data.next_cursor).toBe('task-cursor');
    });
  });

  // ── POST /core/users ──────────────────────────────────────────────────────────

  describe('POST /api/v1/core/users', () => {
    it('upserts a user and returns 201', async () => {
      vi.mocked(svc.upsertUser).mockResolvedValueOnce(makeUser() as never);

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/core/users',
        headers: { authorization: `Bearer ${token}` },
        body: { tenant_id: 'ten_test', email: 'alice@example.com', full_name: 'Alice', role: 'engineer' }
      });

      expect(res.statusCode).toBe(201);
      expect(JSON.parse(res.body).data.email).toBe('alice@example.com');
    });

    it('returns 400 when email is invalid', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/core/users',
        headers: { authorization: `Bearer ${token}` },
        body: { tenant_id: 'ten_test', email: 'not-an-email', full_name: 'X', role: 'dev' }
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /core/users (list) ────────────────────────────────────────────────────

  describe('GET /api/v1/core/users', () => {
    it('returns user list with pagination metadata', async () => {
      vi.mocked(svc.listUsers).mockResolvedValueOnce({
        items: [makeUser()] as never,
        nextCursor: null
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/core/users',
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.items).toHaveLength(1);
      expect(body.data.next_cursor).toBeNull();
    });
  });

  // ── POST /core/teams/:id/members ─────────────────────────────────────────────

  describe('POST /api/v1/core/teams/:team_id/members', () => {
    it('adds a member and returns 201', async () => {
      vi.mocked(svc.addTeamMember).mockResolvedValueOnce({ id: 'mem-1' } as never);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/core/teams/${TEST_TEAM_ID}/members`,
        headers: { authorization: `Bearer ${token}` },
        body: { user_id: TEST_USER_ID }
      });

      expect(res.statusCode).toBe(201);
    });

    it('returns 404 when team or user is not found', async () => {
      vi.mocked(svc.addTeamMember).mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/core/teams/${TEST_TEAM_ID}/members`,
        headers: { authorization: `Bearer ${token}` },
        body: { user_id: TEST_USER_ID }
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 400 when user_id is not a valid UUID', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/core/teams/${TEST_TEAM_ID}/members`,
        headers: { authorization: `Bearer ${token}` },
        body: { user_id: 'not-a-uuid' }
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── DELETE /core/teams/:id/members/:user_id ───────────────────────────────────

  describe('DELETE /api/v1/core/teams/:team_id/members/:user_id', () => {
    it('removes a member and returns 204', async () => {
      vi.mocked(svc.removeTeamMember).mockResolvedValueOnce({ id: 'mem-1' } as never);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/core/teams/${TEST_TEAM_ID}/members/${TEST_USER_ID}`,
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.statusCode).toBe(204);
    });

    it('returns 404 when membership does not exist', async () => {
      vi.mocked(svc.removeTeamMember).mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/core/teams/${TEST_TEAM_ID}/members/00000000-0000-0000-0000-000000000000`,
        headers: { authorization: `Bearer ${token}` }
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── Tenant isolation via token ────────────────────────────────────────────────

  describe('Tenant isolation', () => {
    it('rejects requests where body tenant_id differs from JWT tenant_id', async () => {
      // Token is for ten_test, but body claims ten_evil
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/core/users',
        headers: { authorization: `Bearer ${token}` },
        body: { tenant_id: 'ten_evil', email: 'x@x.com', full_name: 'X', role: 'dev' }
      });

      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error.details.reason).toBe('tenant_mismatch');
    });

    it('GET requests use tenant_id from JWT, not query params', async () => {
      vi.mocked(svc.listProjects).mockResolvedValueOnce({ items: [] as never, nextCursor: null });

      await app.inject({
        method: 'GET',
        url: '/api/v1/core/projects',
        headers: { authorization: `Bearer ${token}` }
      });

      // The tenant_id passed to service must always be from the JWT
      expect(svc.listProjects).toHaveBeenCalledWith('ten_test', expect.any(Object));
    });
  });
});
