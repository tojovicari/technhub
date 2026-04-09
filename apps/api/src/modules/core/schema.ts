import { z } from 'zod';

export const createTeamSchema = z.object({
  tenant_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  lead_id: z.string().uuid().optional(),
  budget_quarterly: z.number().optional(),
  tags: z.array(z.string()).optional().default([])
});

export const createProjectSchema = z.object({
  tenant_id: z.string().min(1),
  key: z.string().min(1).max(24),
  name: z.string().min(1),
  team_id: z.string().uuid().optional(),
  status: z.enum(['planning', 'active', 'on_hold', 'done']).optional().default('planning'),
  start_date: z.string().datetime().optional(),
  target_end_date: z.string().datetime().optional(),
  sync_config: z.record(z.unknown()).optional(),
  custom_fields: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional().default([])
});

export const createEpicSchema = z.object({
  tenant_id: z.string().min(1),
  project_id: z.string().uuid(),
  source: z.enum(['jira', 'github', 'manual']).default('manual'),
  source_id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  goal: z.string().optional(),
  status: z.enum(['backlog', 'active', 'completed', 'cancelled']).optional().default('backlog'),
  owner_id: z.string().uuid().optional(),
  start_date: z.string().datetime().optional(),
  target_end_date: z.string().datetime().optional()
});

export const createTaskSchema = z.object({
  tenant_id: z.string().min(1),
  source: z.enum(['jira', 'github', 'manual']).default('manual'),
  source_id: z.string().optional(),
  project_id: z.string().uuid(),
  epic_id: z.string().uuid().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  task_type: z.enum(['feature', 'bug', 'chore', 'spike', 'tech_debt']),
  priority: z.enum(['P0', 'P1', 'P2', 'P3', 'P4']).optional().default('P2'),
  status: z.enum(['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled']).optional().default('backlog'),
  assignee_id: z.string().uuid().optional(),
  reporter_id: z.string().uuid().optional(),
  story_points: z.number().int().optional(),
  hours_estimated: z.number().optional(),
  due_date: z.string().datetime().optional(),
  related_pr_ids: z.array(z.string()).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
  custom_fields: z.record(z.unknown()).optional()
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  priority: z.enum(['P0', 'P1', 'P2', 'P3', 'P4']).optional(),
  status: z.enum(['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled']).optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  story_points: z.number().int().nullable().optional(),
  hours_estimated: z.number().nullable().optional(),
  hours_actual: z.number().nullable().optional(),
  due_date: z.string().datetime().nullable().optional(),
  tags: z.array(z.string()).optional(),
  custom_fields: z.record(z.unknown()).optional()
});

export const createUserSchema = z.object({
  tenant_id: z.string().min(1),
  email: z.string().email(),
  full_name: z.string().min(1),
  role: z.string().min(1),
  external_id: z.string().optional()
});

export const addTeamMemberSchema = z.object({
  user_id: z.string().uuid()
});

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  cursor: z.string().uuid().optional(),
  status: z.string().optional(),
  project_id: z.string().uuid().optional(),
  epic_id: z.string().uuid().optional(),
  assignee_id: z.string().uuid().optional()
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type CreateEpicInput = z.infer<typeof createEpicSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type AddTeamMemberInput = z.infer<typeof addTeamMemberSchema>;
export type ListQueryInput = z.infer<typeof listQuerySchema>;
