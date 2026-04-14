import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { prisma } from '../../../lib/prisma.js';
import type { IntegrationConnector, SyncInput, SyncResult, WebhookConfig } from './base.js';

// ── Types ──────────────────────────────────────────────────────────────────────

type GithubAppCredentials = {
  auth_type: 'app';
  app_id: number;
  private_key_pem: string;
  installation_id: number;
};

type GithubScope = {
  org: string;
  repos?: string[]; // optional allowlist; if absent, sync all repos in the org
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildOctokit(creds: GithubAppCredentials): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: creds.app_id,
      privateKey: creds.private_key_pem,
      installationId: creds.installation_id,
    },
  });
}

type CanonicalTaskType = 'feature' | 'bug' | 'chore' | 'spike' | 'tech_debt';

function resolveTaskType(
  labels: string[],
  typeMapping?: Record<string, string>,
  fallbackOriginalType = 'unlabeled',
): { taskType: CanonicalTaskType | null; originalType: string } {
  // Only tenant-configured mapping determines taskType — no built-in heuristics.
  // This gives the tenant full control over classification via the type-mapping API.
  if (typeMapping) {
    for (const label of labels) {
      const mapped = typeMapping[label] as CanonicalTaskType | undefined;
      if (mapped) return { taskType: mapped, originalType: label };
    }
  }

  // No mapping match — originalType is the first label (mapeável via API) or the fallback
  const originalType = labels[0] ?? fallbackOriginalType;
  return { taskType: null, originalType };
}

function resolveTaskPriority(labels: string[]): 'P0' | 'P1' | 'P2' | 'P3' | 'P4' {
  const l = labels.map(s => s.toLowerCase());
  if (l.some(s => s === 'p0' || s === 'critical' || s === 'urgent')) return 'P0';
  if (l.some(s => s === 'p1' || s === 'high')) return 'P1';
  if (l.some(s => s === 'p3' || s === 'low')) return 'P3';
  if (l.some(s => s === 'p4' || s === 'lowest' || s === 'trivial')) return 'P4';
  return 'P2';
}

function resolveIssueStatus(issue: { state: string; assignee: unknown }): 'todo' | 'in_progress' | 'done' {
  if (issue.state === 'closed') return 'done';
  if (issue.assignee) return 'in_progress';
  return 'todo';
}

function resolvePrStatus(pr: { state: string; merged_at: string | null }): 'review' | 'done' | 'cancelled' {
  if (pr.state === 'open') return 'review';
  if (pr.merged_at) return 'done';
  return 'cancelled';
}

// ── Sync functions ─────────────────────────────────────────────────────────────

async function syncMembers(octokit: Octokit, tenantId: string, org: string): Promise<number> {
  // Try org members first; fall back to the owner's own profile for personal accounts
  let logins: string[] = [];
  try {
    const members = await octokit.paginate(octokit.orgs.listMembers, { org, per_page: 100 });
    logins = members.map(m => m.login);
  } catch {
    // Not an org or no access — sync just the owner
    logins = [org];
  }

  if (logins.length === 0) logins = [org];

  let count = 0;
  for (const login of logins) {
    const { data: profile } = await octokit.users.getByUsername({ username: login });
    const email = profile.email ?? `${login}@users.noreply.github.com`;
    const fullName = profile.name ?? login;

    await prisma.user.upsert({
      where: { tenantId_email: { tenantId, email } },
      create: { tenantId, email, fullName, role: 'developer' },
      update: { fullName },
    });
    count++;
  }
  return count;
}

async function syncRepos(
  octokit: Octokit,
  tenantId: string,
  org: string,
  allowlist?: string[],
): Promise<Array<{ id: string; repoName: string }>> {
  // Use installation-scoped endpoint — works for both orgs and personal accounts
  const { data } = await octokit.apps.listReposAccessibleToInstallation({ per_page: 100 });
  const allRepos = data.repositories.filter(r => r.owner.login === org);

  const filtered = allowlist
    ? allRepos.filter(r => allowlist.includes(r.name))
    : allRepos;

  const results: Array<{ id: string; repoName: string }> = [];

  for (const repo of filtered) {
    const key = `${org}/${repo.name}`;
    const project = await prisma.project.upsert({
      where: { tenantId_key: { tenantId, key } },
      create: {
        tenantId,
        key,
        name: repo.full_name,
        status: repo.archived ? 'done' : 'active',
      },
      update: {
        name: repo.full_name,
        status: repo.archived ? 'done' : 'active',
      },
    });
    await prisma.projectSource.upsert({
      where: { projectId_provider_externalId: { projectId: project.id, provider: 'github', externalId: repo.full_name } },
      create: { tenantId, projectId: project.id, provider: 'github', externalId: repo.full_name, displayName: repo.full_name },
      update: { displayName: repo.full_name },
    });
    results.push({ id: project.id, repoName: repo.name });
  }

  return results;
}

async function syncMilestones(
  octokit: Octokit,
  tenantId: string,
  org: string,
  repoName: string,
  projectId: string,
): Promise<number> {
  const milestones = await octokit.paginate(octokit.issues.listMilestones, {
    owner: org,
    repo: repoName,
    state: 'all',
    per_page: 100,
  });

  for (const ms of milestones) {
    const sourceId = `${org}/${repoName}#milestone#${ms.number}`;
    const status = ms.state === 'closed' ? 'completed' : 'active';

    await prisma.epic.upsert({
      where: { tenantId_source_sourceId: { tenantId, source: 'github', sourceId } },
      create: {
        tenantId,
        projectId,
        source: 'github',
        sourceId,
        name: ms.title,
        description: ms.description ?? undefined,
        status,
        targetEndDate: ms.due_on ? new Date(ms.due_on) : undefined,
      },
      update: {
        name: ms.title,
        description: ms.description ?? undefined,
        status,
        targetEndDate: ms.due_on ? new Date(ms.due_on) : undefined,
      },
    });
  }

  return milestones.length;
}

async function syncIssues(
  octokit: Octokit,
  tenantId: string,
  org: string,
  repoName: string,
  projectId: string,
  connectionId: string,
  typeMapping: Record<string, string> | undefined,
  since?: string,
): Promise<number> {
  const issues = await octokit.paginate(octokit.issues.listForRepo, {
    owner: org,
    repo: repoName,
    state: 'all',
    per_page: 100,
    ...(since ? { since } : {}),
  });

  // Filter out pull requests (GitHub issues API returns PRs too)
  const realIssues = issues.filter(i => !i.pull_request);

  for (const issue of realIssues) {
    const sourceId = `${org}/${repoName}#issue#${issue.number}`;
    const labels = issue.labels
      .map(l => (typeof l === 'string' ? l : l.name ?? ''))
      .filter(Boolean);
    const { taskType, originalType } = resolveTaskType(labels, typeMapping);
    const priority = resolveTaskPriority(labels);
    const status = resolveIssueStatus({ state: issue.state, assignee: issue.assignee });

    // Resolve assignee by email
    let assigneeId: string | undefined;
    if (issue.assignee?.login) {
      const email = `${issue.assignee.login}@users.noreply.github.com`;
      const user = await prisma.user.findUnique({ where: { tenantId_email: { tenantId, email } } });
      assigneeId = user?.id;
    }

    // Resolve milestone → Epic
    let epicId: string | undefined;
    if (issue.milestone) {
      const epicSourceId = `${org}/${repoName}#milestone#${issue.milestone.number}`;
      const epic = await prisma.epic.findUnique({
        where: { tenantId_source_sourceId: { tenantId, source: 'github', sourceId: epicSourceId } },
      });
      epicId = epic?.id;
    }

    const task = await prisma.task.upsert({
      where: { tenantId_source_sourceId: { tenantId, source: 'github', sourceId } },
      create: {
        tenantId,
        projectId,
        epicId,
        source: 'github',
        sourceId,
        title: issue.title,
        description: issue.body ?? undefined,
        taskType: taskType ?? undefined,
        originalType,
        connectionId,
        priority,
        status,
        assigneeId,
        dueDate: issue.milestone?.due_on ? new Date(issue.milestone.due_on) : undefined,
        startedAt: issue.state === 'open' && issue.assignee ? new Date(issue.created_at) : undefined,
        completedAt: issue.closed_at ? new Date(issue.closed_at) : undefined,
        tags: labels,
      },
      update: {
        title: issue.title,
        description: issue.body ?? undefined,
        taskType: taskType ?? undefined,
        originalType,
        connectionId,
        status,
        assigneeId,
        epicId,
        completedAt: issue.closed_at ? new Date(issue.closed_at) : undefined,
        tags: labels,
      },
    });

  }

  return realIssues.length;
}

async function syncPullRequests(
  octokit: Octokit,
  tenantId: string,
  org: string,
  repoName: string,
  projectId: string,
  connectionId: string,
  typeMapping: Record<string, string> | undefined,
  since?: string,
): Promise<number> {
  const prs = await octokit.paginate(octokit.pulls.list, {
    owner: org,
    repo: repoName,
    state: 'all',
    per_page: 100,
    sort: 'updated',
    direction: 'desc',
  });

  const filtered = since
    ? prs.filter(pr => new Date(pr.updated_at) >= new Date(since))
    : prs;

  for (const pr of filtered) {
    const sourceId = `${org}/${repoName}#pr#${pr.number}`;
    const status = resolvePrStatus({ state: pr.state, merged_at: pr.merged_at });

    let assigneeId: string | undefined;
    if (pr.user?.login) {
      const email = `${pr.user.login}@users.noreply.github.com`;
      const user = await prisma.user.findUnique({ where: { tenantId_email: { tenantId, email } } });
      assigneeId = user?.id;
    }

    const prLabels = (pr.labels ?? []).map((l: { name?: string } | string) =>
      typeof l === 'string' ? l : (l.name ?? '')
    ).filter(Boolean);
    const { taskType: prTaskType, originalType: prOriginalType } = resolveTaskType(
      prLabels,
      typeMapping,
      'pull_request',
    );
    const prPriority = resolveTaskPriority(prLabels);

    const prTask = await prisma.task.upsert({
      where: { tenantId_source_sourceId: { tenantId, source: 'github', sourceId } },
      create: {
        tenantId,
        projectId,
        connectionId,
        source: 'github',
        sourceId,
        title: pr.title,
        description: pr.body ?? undefined,
        taskType: prTaskType ?? undefined,
        originalType: prOriginalType,
        priority: prPriority,
        status,
        assigneeId,
        startedAt: new Date(pr.created_at),
        completedAt: pr.merged_at ? new Date(pr.merged_at) : undefined,
        tags: prLabels,
      },
      update: {
        title: pr.title,
        taskType: prTaskType ?? undefined,
        originalType: prOriginalType,
        connectionId,
        status,
        assigneeId,
        completedAt: pr.merged_at ? new Date(pr.merged_at) : undefined,
        tags: prLabels,
      },
    });
  }

  return filtered.length;
}

// ── Connector ──────────────────────────────────────────────────────────────────

export class GithubConnector implements IntegrationConnector {
  provider = 'github' as const;

  webhookConfig: WebhookConfig = {
    eventIdHeader: 'x-github-delivery',
    eventTypeHeader: 'x-github-event',
    tokenEnvVar: 'GITHUB_WEBHOOK_TOKEN',
    devToken: 'dev-github-webhook-token',
  };

  async validateConfiguration(): Promise<void> {
    // Credentials are validated at runSync time via the GitHub API.
    // Format validation is handled by the schema layer on connection creation.
  }

  async runSync(input: SyncInput): Promise<SyncResult> {
    const creds = input.credentials as GithubAppCredentials | undefined;
    if (!creds || creds.auth_type !== 'app') {
      throw new Error('GitHub App credentials not provided (auth_type must be "app")');
    }

    const scope = input.scope as GithubScope | undefined;
    if (!scope?.org) {
      throw new Error('GitHub org required in connection scope (scope.org)');
    }

    const octokit = buildOctokit(creds);
    const { org } = scope;
    const since = input.sinceDate?.toISOString();

    let synced = 0;

    // Load tenant-configured type mapping for this connection
    const connectionRecord = await prisma.integrationConnection.findUnique({
      where: { id: input.connectionId },
      select: { typeMapping: true },
    });
    const typeMapping = (connectionRecord?.typeMapping as Record<string, string> | null) ?? undefined;

    synced += await syncMembers(octokit, input.tenantId, org);

    const projects = await syncRepos(octokit, input.tenantId, org, scope.repos);
    synced += projects.length;

    for (const { id: projectId, repoName } of projects) {
      synced += await syncMilestones(octokit, input.tenantId, org, repoName, projectId);
      synced += await syncIssues(octokit, input.tenantId, org, repoName, projectId, input.connectionId, typeMapping, since);
      synced += await syncPullRequests(octokit, input.tenantId, org, repoName, projectId, input.connectionId, typeMapping, since);
    }

    return {
      provider: this.provider,
      mode: input.mode,
      synced_entities: synced,
    };
  }
}

