import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock Prisma before any service import ────────────────────────────────────
// vi.mock factories are hoisted; use vi.hoisted() to safely share references

const mockPrisma = vi.hoisted(() => ({
  tenant: { upsert: vi.fn() },
  team: { create: vi.fn(), findFirst: vi.fn() },
  project: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  epic: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  task: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  user: { upsert: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  teamMember: { upsert: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), delete: vi.fn() }
}));

vi.mock('../../lib/prisma.js', () => ({ prisma: mockPrisma }));

import {
  addTeamMember,
  createProject,
  createTask,
  createTeam,
  listEpics,
  listProjects,
  listTasks,
  listUsers,
  removeTeamMember,
  updateTask,
  upsertUser
} from './service.js';

// ── Factories ────────────────────────────────────────────────────────────────

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    tenantId: 'ten_test',
    source: 'manual',
    sourceId: null,
    projectId: 'proj-1',
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

// ── Task lifecycle ────────────────────────────────────────────────────────────

describe('createTask — lifecycle', () => {
  beforeEach(() => {
    mockPrisma.tenant.upsert.mockResolvedValue({});
    mockPrisma.task.findMany.mockResolvedValue([]);
    mockPrisma.epic.update.mockResolvedValue({});
  });

  it('does not set startedAt or completedAt for backlog tasks', async () => {
    mockPrisma.task.create.mockResolvedValue(makeTask({ status: 'backlog' }));

    await createTask({
      tenant_id: 'ten_test',
      project_id: 'proj-1',
      title: 'Do something',
      task_type: 'feature',
      priority: 'P2',
      status: 'backlog',
      source: 'manual',
      related_pr_ids: [],
      tags: []
    });

    const data = mockPrisma.task.create.mock.calls[0][0].data;
    expect(data.startedAt).toBeNull();
    expect(data.completedAt).toBeNull();
    expect(data.cycleTimeHours).toBeNull();
  });

  it('sets startedAt (but not completedAt) when status is in_progress', async () => {
    mockPrisma.task.create.mockResolvedValue(makeTask({ status: 'in_progress' }));

    await createTask({
      tenant_id: 'ten_test',
      project_id: 'proj-1',
      title: 'Do something',
      task_type: 'feature',
      priority: 'P2',
      status: 'in_progress',
      source: 'manual',
      related_pr_ids: [],
      tags: []
    });

    const data = mockPrisma.task.create.mock.calls[0][0].data;
    expect(data.startedAt).toBeInstanceOf(Date);
    expect(data.completedAt).toBeNull();
    expect(data.cycleTimeHours).toBeNull();
  });

  it('sets both startedAt and completedAt and calculates cycleTimeHours when status is done', async () => {
    mockPrisma.task.create.mockResolvedValue(makeTask({ status: 'done' }));

    await createTask({
      tenant_id: 'ten_test',
      project_id: 'proj-1',
      title: 'Do something',
      task_type: 'feature',
      priority: 'P2',
      status: 'done',
      source: 'manual',
      related_pr_ids: [],
      tags: []
    });

    const data = mockPrisma.task.create.mock.calls[0][0].data;
    expect(data.startedAt).toBeInstanceOf(Date);
    expect(data.completedAt).toBeInstanceOf(Date);
    expect(data.cycleTimeHours).toBeDefined();
    expect(typeof data.cycleTimeHours).toBe('number');
  });
});

describe('updateTask — lifecycle', () => {
  beforeEach(() => {
    mockPrisma.task.findMany.mockResolvedValue([]);
    mockPrisma.epic.update.mockResolvedValue({});
  });

  it('returns null when task does not exist', async () => {
    mockPrisma.task.findFirst.mockResolvedValue(null);

    const result = await updateTask('non-existent', 'ten_test', { status: 'done' });

    expect(result).toBeNull();
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  it('sets completedAt and calculates cycleTimeHours when transitioning to done', async () => {
    const startedAt = new Date(Date.now() - 7_200_000); // 2 hours ago
    mockPrisma.task.findFirst.mockResolvedValue(
      makeTask({ status: 'in_progress', startedAt, completedAt: null })
    );
    mockPrisma.task.update.mockResolvedValue(makeTask({ status: 'done' }));

    await updateTask('task-1', 'ten_test', { status: 'done' });

    const data = mockPrisma.task.update.mock.calls[0][0].data;
    expect(data.completedAt).toBeInstanceOf(Date);
    expect(data.cycleTimeHours).toBeGreaterThanOrEqual(1.9); // ~2h
  });

  it('preserves existing startedAt when task is already in_progress', async () => {
    const startedAt = new Date(Date.now() - 3_600_000);
    mockPrisma.task.findFirst.mockResolvedValue(
      makeTask({ status: 'in_progress', startedAt })
    );
    mockPrisma.task.update.mockResolvedValue(makeTask({ status: 'in_progress' }));

    await updateTask('task-1', 'ten_test', { title: 'New title' });

    const data = mockPrisma.task.update.mock.calls[0][0].data;
    expect(data.startedAt?.getTime()).toBe(startedAt.getTime());
  });
});

// ── refreshEpicCounters is called after mutations ─────────────────────────────

describe('epic counter refresh', () => {
  beforeEach(() => {
    mockPrisma.tenant.upsert.mockResolvedValue({});
    mockPrisma.task.update.mockResolvedValue(makeTask({ epicId: 'epic-1' }));
    mockPrisma.task.findFirst.mockResolvedValue(makeTask({ epicId: 'epic-1', status: 'in_progress', startedAt: new Date() }));
    mockPrisma.epic.update.mockResolvedValue({});
  });

  it('aggregates task stats and updates epic after updateTask', async () => {
    mockPrisma.task.findMany.mockResolvedValue([
      makeTask({ epicId: 'epic-1', status: 'done', storyPoints: 3, hoursActual: 4 }),
      makeTask({ epicId: 'epic-1', status: 'in_progress', storyPoints: 2, hoursActual: 1 })
    ]);

    await updateTask('task-1', 'ten_test', { status: 'done' });

    expect(mockPrisma.epic.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'epic-1' },
        data: expect.objectContaining({
          totalTasks: 2,
          completedTasks: 1,
          totalStoryPoints: 5,
          actualHours: 5
        })
      })
    );
  });

  it('skips epic update when task has no epicId', async () => {
    mockPrisma.task.findFirst.mockResolvedValue(makeTask({ epicId: null }));
    mockPrisma.task.update.mockResolvedValue(makeTask({ epicId: null }));
    mockPrisma.task.findMany.mockResolvedValue([]);

    await updateTask('task-1', 'ten_test', { status: 'done' });

    expect(mockPrisma.epic.update).not.toHaveBeenCalled();
  });
});

// ── User management ───────────────────────────────────────────────────────────

describe('upsertUser', () => {
  it('upserts by tenantId+email composite key', async () => {
    mockPrisma.tenant.upsert.mockResolvedValue({});
    mockPrisma.user.upsert.mockResolvedValue({ id: 'usr-1', email: 'a@b.com' });

    await upsertUser({ tenant_id: 'ten_test', email: 'a@b.com', full_name: 'A B', role: 'dev' });

    expect(mockPrisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_email: { tenantId: 'ten_test', email: 'a@b.com' } }
      })
    );
  });
});

describe('listUsers', () => {
  it('limits results and returns nextCursor when there are more', async () => {
    const users = Array.from({ length: 6 }, (_, i) => ({ id: `usr-${i}` }));
    mockPrisma.user.findMany.mockResolvedValue(users);

    const { items, nextCursor } = await listUsers('ten_test', 5);

    expect(items).toHaveLength(5);
    expect(nextCursor).toBe('usr-4');
  });

  it('returns null nextCursor on the last page', async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'usr-1' }, { id: 'usr-2' }]);

    const { items, nextCursor } = await listUsers('ten_test', 5);

    expect(items).toHaveLength(2);
    expect(nextCursor).toBeNull();
  });
});

// ── Team member management ────────────────────────────────────────────────────

describe('addTeamMember', () => {
  it('returns null when team does not belong to tenant', async () => {
    mockPrisma.team.findFirst.mockResolvedValue(null);
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'usr-1' });

    const result = await addTeamMember('team-x', 'ten_test', { user_id: 'usr-1' });

    expect(result).toBeNull();
    expect(mockPrisma.teamMember.upsert).not.toHaveBeenCalled();
  });

  it('returns null when user does not belong to tenant', async () => {
    mockPrisma.team.findFirst.mockResolvedValue({ id: 'team-1' });
    mockPrisma.user.findFirst.mockResolvedValue(null);

    const result = await addTeamMember('team-1', 'ten_test', { user_id: 'usr-x' });

    expect(result).toBeNull();
  });

  it('upserts member (idempotent) when both team and user exist', async () => {
    mockPrisma.team.findFirst.mockResolvedValue({ id: 'team-1' });
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'usr-1' });
    mockPrisma.teamMember.upsert.mockResolvedValue({ id: 'mem-1' });

    const result = await addTeamMember('team-1', 'ten_test', { user_id: 'usr-1' });

    expect(result).toBeTruthy();
    expect(mockPrisma.teamMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { teamId_userId: { teamId: 'team-1', userId: 'usr-1' } }
      })
    );
  });
});

describe('removeTeamMember', () => {
  it('returns null when membership does not exist', async () => {
    mockPrisma.teamMember.findFirst.mockResolvedValue(null);

    const result = await removeTeamMember('team-1', 'usr-1', 'ten_test');

    expect(result).toBeNull();
    expect(mockPrisma.teamMember.delete).not.toHaveBeenCalled();
  });

  it('deletes the membership when found', async () => {
    mockPrisma.teamMember.findFirst.mockResolvedValue({ id: 'mem-1' });
    mockPrisma.teamMember.delete.mockResolvedValue({ id: 'mem-1' });

    await removeTeamMember('team-1', 'usr-1', 'ten_test');

    expect(mockPrisma.teamMember.delete).toHaveBeenCalledWith({ where: { id: 'mem-1' } });
  });
});

// ── Pagination ────────────────────────────────────────────────────────────────

describe('listProjects — cursor pagination', () => {
  it('passes cursor and skip to Prisma when cursor is provided', async () => {
    mockPrisma.project.findMany.mockResolvedValue([]);

    await listProjects('ten_test', { limit: 10, cursor: 'proj-cursor' });

    expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: 'proj-cursor' },
        skip: 1,
        take: 11
      })
    );
  });

  it('applies status filter', async () => {
    mockPrisma.project.findMany.mockResolvedValue([]);

    await listProjects('ten_test', { limit: 10, status: 'active' });

    expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'active' })
      })
    );
  });
});

describe('listTasks — filters', () => {
  it('applies all optional filters when provided', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    await listTasks('ten_test', {
      limit: 5,
      status: 'done',
      project_id: 'proj-1',
      epic_id: 'epic-1',
      assignee_id: 'usr-1'
    });

    expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'ten_test',
          status: 'done',
          projectId: 'proj-1',
          epicId: 'epic-1',
          assigneeId: 'usr-1'
        })
      })
    );
  });
});

describe('listEpics — filters', () => {
  it('applies project_id filter', async () => {
    mockPrisma.epic.findMany.mockResolvedValue([]);

    await listEpics('ten_test', { limit: 10, project_id: 'proj-1' });

    expect(mockPrisma.epic.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ projectId: 'proj-1' })
      })
    );
  });
});

// ── Tenant isolation ──────────────────────────────────────────────────────────

describe('createTeam — ensureTenant', () => {
  it('upserts the tenant before creating the team', async () => {
    mockPrisma.tenant.upsert.mockResolvedValue({});
    mockPrisma.team.create.mockResolvedValue({ id: 'team-1', tenantId: 'ten_test', name: 'X', description: null, leadId: null, budgetQuarterly: null, tags: [] });

    await createTeam({ tenant_id: 'ten_test', name: 'X', tags: [] });

    expect(mockPrisma.tenant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ten_test' } })
    );
    expect(mockPrisma.team.create).toHaveBeenCalled();
  });
});

describe('createProject — tenant scoping', () => {
  it('always passes tenantId from input (never from request context)', async () => {
    mockPrisma.tenant.upsert.mockResolvedValue({});
    mockPrisma.project.create.mockResolvedValue({ id: 'proj-1', tenantId: 'ten_test' });

    await createProject({ tenant_id: 'ten_test', key: 'TST', name: 'Test', tags: [], status: 'planning' });

    const createData = mockPrisma.project.create.mock.calls[0][0].data;
    expect(createData.tenantId).toBe('ten_test');
  });
});
