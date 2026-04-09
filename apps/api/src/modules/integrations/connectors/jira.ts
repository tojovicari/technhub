import { prisma } from '../../../lib/prisma.js';
import type { IntegrationConnector, SyncInput, SyncResult, WebhookConfig } from './base.js';

// ── Types ──────────────────────────────────────────────────────────────────────

type JiraTokenCredentials = {
  auth_type: 'token';
  base_url: string;  // e.g. "https://myorg.atlassian.net"
  email: string;
  access_token: string;
};

type JiraScope = {
  project_keys?: string[]; // optional allowlist; if absent, sync all projects
};

// ── HTTP client ────────────────────────────────────────────────────────────────

class JiraClient {
  private readonly authHeader: string;
  readonly baseUrl: string;

  constructor(creds: JiraTokenCredentials) {
    this.baseUrl = creds.base_url.replace(/\/$/, '');
    this.authHeader = `Basic ${Buffer.from(`${creds.email}:${creds.access_token}`).toString('base64')}`;
  }

  async get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
    const url = new URL(`${this.baseUrl}/rest/api/3${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, String(v));
      }
    }
    const res = await fetch(url.toString(), {
      headers: { Authorization: this.authHeader, Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`Jira API error ${res.status} on GET ${path}: ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  /** Paginate through Jira's startAt/total model and collect all items */
  async paginate<T>(path: string, itemsKey: string, extraParams?: Record<string, string | number>): Promise<T[]> {
    const results: T[] = [];
    let startAt = 0;
    const maxResults = 100;

    while (true) {
      const page = await this.get<Record<string, unknown>>(path, { ...extraParams, startAt, maxResults });
      const items = (page[itemsKey] as T[]) ?? [];
      results.push(...items);
      const total = (page.total as number) ?? 0;
      startAt += items.length;
      if (startAt >= total || items.length === 0) break;
    }

    return results;
  }
}

// ── Mapping helpers ────────────────────────────────────────────────────────────

function resolveTaskType(issueTypeName: string): 'feature' | 'bug' | 'chore' | 'spike' | 'tech_debt' {
  const t = issueTypeName.toLowerCase();
  if (t === 'bug' || t === 'defect') return 'bug';
  if (t.includes('tech debt') || t === 'technical debt' || t === 'refactoring') return 'tech_debt';
  if (t === 'spike' || t === 'research') return 'spike';
  if (t === 'task' || t === 'sub-task' || t === 'chore') return 'chore';
  return 'feature';
}

function resolveTaskPriority(priorityName: string): 'P0' | 'P1' | 'P2' | 'P3' | 'P4' {
  const p = priorityName.toLowerCase();
  if (p === 'critical' || p === 'blocker' || p === 'p0') return 'P0';
  if (p === 'high' || p === 'major' || p === 'p1') return 'P1';
  if (p === 'low' || p === 'minor' || p === 'p3') return 'P3';
  if (p === 'trivial' || p === 'lowest' || p === 'p4') return 'P4';
  return 'P2';
}

function resolveTaskStatus(statusCategory: string): 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled' {
  switch (statusCategory.toLowerCase()) {
    case 'done': return 'done';
    case 'in progress': return 'in_progress';
    case 'to do': return 'todo';
    default: return 'backlog';
  }
}

// ── Sync functions ─────────────────────────────────────────────────────────────

async function syncUsers(client: JiraClient, tenantId: string): Promise<number> {
  type JiraUser = { emailAddress?: string; displayName: string; accountType: string };
  const users = await client.paginate<JiraUser>('/users/search', 'values', { accountType: 'atlassian' });
  let count = 0;

  for (const u of users) {
    if (!u.emailAddress || u.accountType !== 'atlassian') continue;
    await prisma.user.upsert({
      where: { tenantId_email: { tenantId, email: u.emailAddress } },
      create: { tenantId, email: u.emailAddress, fullName: u.displayName, role: 'developer' },
      update: { fullName: u.displayName },
    });
    count++;
  }

  return count;
}

async function syncProjects(
  client: JiraClient,
  tenantId: string,
  allowlist?: string[],
): Promise<Array<{ id: string; jiraKey: string }>> {
  type JiraProject = { id: string; key: string; name: string; projectTypeKey: string };
  const projects = await client.paginate<JiraProject>('/project/search', 'values');

  const filtered = allowlist
    ? projects.filter(p => allowlist.includes(p.key))
    : projects;

  const results: Array<{ id: string; jiraKey: string }> = [];

  for (const p of filtered) {
    const project = await prisma.project.upsert({
      where: { tenantId_key: { tenantId, key: p.key } },
      create: { tenantId, key: p.key, name: p.name, status: 'active' },
      update: { name: p.name },
    });
    results.push({ id: project.id, jiraKey: p.key });
  }

  return results;
}

async function syncEpics(
  client: JiraClient,
  tenantId: string,
  projectKey: string,
  projectId: string,
): Promise<Map<string, string>> {
  // epicKey → internal epic id
  const epicMap = new Map<string, string>();

  type JiraIssue = {
    key: string;
    fields: {
      summary: string;
      description?: unknown;
      status: { statusCategory: { name: string } };
      duedate?: string;
      resolutiondate?: string;
    };
  };

  const epics = await client.paginate<JiraIssue>(
    '/search',
    'issues',
    { jql: `project="${projectKey}" AND issuetype=Epic ORDER BY created ASC`, fields: 'summary,description,status,duedate,resolutiondate' },
  );

  for (const e of epics) {
    const statusCategory = e.fields.status.statusCategory.name;
    const status = statusCategory.toLowerCase() === 'done' ? 'completed' : 'active';

    const epic = await prisma.epic.upsert({
      where: { tenantId_source_sourceId: { tenantId, source: 'jira', sourceId: e.key } },
      create: {
        tenantId,
        projectId,
        source: 'jira',
        sourceId: e.key,
        name: e.fields.summary,
        status,
        targetEndDate: e.fields.duedate ? new Date(e.fields.duedate) : undefined,
        actualEndDate: e.fields.resolutiondate ? new Date(e.fields.resolutiondate) : undefined,
      },
      update: {
        name: e.fields.summary,
        status,
        targetEndDate: e.fields.duedate ? new Date(e.fields.duedate) : undefined,
        actualEndDate: e.fields.resolutiondate ? new Date(e.fields.resolutiondate) : undefined,
      },
    });

    epicMap.set(e.key, epic.id);
  }

  return epicMap;
}

async function syncIssues(
  client: JiraClient,
  tenantId: string,
  projectKey: string,
  projectId: string,
  epicMap: Map<string, string>,
  since?: Date,
): Promise<number> {
  type JiraIssue = {
    key: string;
    fields: {
      summary: string;
      description?: unknown;
      issuetype: { name: string };
      priority?: { name: string };
      status: { statusCategory: { name: string } };
      assignee?: { emailAddress?: string };
      reporter?: { emailAddress?: string };
      story_points?: number;
      customfield_10016?: number; // story points (common custom field)
      duedate?: string;
      created: string;
      resolutiondate?: string;
      'Epic Link'?: string;
      customfield_10014?: string; // epic link (common custom field)
      labels?: string[];
    };
  };

  const sinceJql = since ? ` AND updatedDate >= "${since.toISOString().slice(0, 10)}"` : '';
  const jql = `project="${projectKey}" AND issuetype != Epic${sinceJql} ORDER BY updated ASC`;

  const issues = await client.paginate<JiraIssue>('/search', 'issues', {
    jql,
    fields: 'summary,description,issuetype,priority,status,assignee,reporter,customfield_10016,duedate,created,resolutiondate,customfield_10014,labels',
  });

  for (const issue of issues) {
    const f = issue.fields;
    const taskType = resolveTaskType(f.issuetype.name);
    const priority = resolveTaskPriority(f.priority?.name ?? 'medium');
    const status = resolveTaskStatus(f.status.statusCategory.name);
    const storyPoints = f.customfield_10016 ?? undefined;

    let assigneeId: string | undefined;
    if (f.assignee?.emailAddress) {
      const user = await prisma.user.findUnique({
        where: { tenantId_email: { tenantId, email: f.assignee.emailAddress } },
      });
      assigneeId = user?.id;
    }

    let reporterId: string | undefined;
    if (f.reporter?.emailAddress) {
      const user = await prisma.user.findUnique({
        where: { tenantId_email: { tenantId, email: f.reporter.emailAddress } },
      });
      reporterId = user?.id;
    }

    // Epic Link via customfield_10014 (epic key string)
    const epicKey = f.customfield_10014 ?? undefined;
    const epicId = epicKey ? epicMap.get(epicKey) : undefined;

    await prisma.task.upsert({
      where: { tenantId_source_sourceId: { tenantId, source: 'jira', sourceId: issue.key } },
      create: {
        tenantId,
        projectId,
        epicId,
        source: 'jira',
        sourceId: issue.key,
        title: f.summary,
        taskType,
        priority,
        status,
        assigneeId,
        reporterId,
        storyPoints,
        dueDate: f.duedate ? new Date(f.duedate) : undefined,
        startedAt: status === 'in_progress' || status === 'done' ? new Date(f.created) : undefined,
        completedAt: f.resolutiondate ? new Date(f.resolutiondate) : undefined,
        tags: f.labels ?? [],
      },
      update: {
        title: f.summary,
        status,
        assigneeId,
        reporterId,
        epicId,
        storyPoints,
        completedAt: f.resolutiondate ? new Date(f.resolutiondate) : undefined,
        tags: f.labels ?? [],
      },
    });
  }

  return issues.length;
}

// ── Connector ──────────────────────────────────────────────────────────────────

export class JiraConnector implements IntegrationConnector {
  provider = 'jira' as const;

  webhookConfig: WebhookConfig = {
    eventIdHeader: 'x-atlassian-webhook-identifier',
    eventTypeHeader: 'x-atlassian-webhook-event',
    tokenEnvVar: 'JIRA_WEBHOOK_TOKEN',
    devToken: 'dev-jira-webhook-token',
  };

  async validateConfiguration(): Promise<void> {
    // Credentials are validated at runSync time via the Jira API.
  }

  async runSync(input: SyncInput): Promise<SyncResult> {
    const creds = input.credentials as JiraTokenCredentials | undefined;
    if (!creds || creds.auth_type !== 'token') {
      throw new Error('Jira API Token credentials not provided (auth_type must be "token")');
    }
    if (!creds.base_url || !creds.email || !creds.access_token) {
      throw new Error('Jira credentials require base_url, email, and access_token');
    }

    const scope = input.scope as JiraScope | undefined;
    const client = new JiraClient(creds);
    let synced = 0;

    synced += await syncUsers(client, input.tenantId);

    const projects = await syncProjects(client, input.tenantId, scope?.project_keys);
    synced += projects.length;

    for (const { id: projectId, jiraKey } of projects) {
      const epicMap = await syncEpics(client, input.tenantId, jiraKey, projectId);
      synced += epicMap.size;
      synced += await syncIssues(client, input.tenantId, jiraKey, projectId, epicMap, input.sinceDate);
    }

    return {
      provider: this.provider,
      mode: input.mode,
      synced_entities: synced,
    };
  }
}

