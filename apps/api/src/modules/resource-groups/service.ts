import type { Prisma } from '@prisma/client';
import {
  type AddResourceGroupResourceBody,
  type AddResourceGroupTeamBody,
  type CreateResourceGroupBody,
  type ListResourceGroupsQuery,
  type UpdateResourceGroupBody
} from './schema.js';
import { prisma } from '../../lib/prisma.js';

async function ensureTenant(tenantId: string) {
  await prisma.tenant.upsert({
    where: { id: tenantId },
    create: {
      id: tenantId,
      name: `Tenant ${tenantId}`,
      slug: tenantId
    },
    update: {}
  });
}

export async function createResourceGroup(tenantId: string, input: CreateResourceGroupBody) {
  await ensureTenant(tenantId);

  return prisma.resourceGroup.create({
    data: {
      tenantId,
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      status: input.status,
      ownerUserId: input.owner_user_id ?? null,
      tags: input.tags
    },
    include: {
      resources: { include: { project: { include: { sources: true } } } },
      teams: { include: { team: true } }
    }
  });
}

export async function listResourceGroups(tenantId: string, query: ListResourceGroupsQuery) {
  const where: Prisma.ResourceGroupWhereInput = {
    tenantId,
    ...(query.status ? { status: query.status } : {})
  };

  const rows = await prisma.resourceGroup.findMany({
    where,
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { resources: true, teams: true } }
    }
  });

  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;

  return {
    items,
    nextCursor: hasMore ? items[items.length - 1].id : null
  };
}

export async function getResourceGroup(tenantId: string, groupId: string) {
  return prisma.resourceGroup.findFirst({
    where: { id: groupId, tenantId },
    include: {
      resources: {
        include: {
          project: {
            include: {
              sources: true,
              team: true
            }
          }
        },
        orderBy: { createdAt: 'asc' }
      },
      teams: {
        include: { team: true },
        orderBy: { createdAt: 'asc' }
      }
    }
  });
}

export async function updateResourceGroup(tenantId: string, groupId: string, input: UpdateResourceGroupBody) {
  const existing = await prisma.resourceGroup.findFirst({ where: { id: groupId, tenantId }, select: { id: true } });
  if (!existing) return null;

  return prisma.resourceGroup.update({
    where: { id: groupId },
    data: {
      key: input.key,
      name: input.name,
      description: input.description === undefined ? undefined : input.description,
      status: input.status,
      ownerUserId: input.owner_user_id === undefined ? undefined : input.owner_user_id,
      tags: input.tags
    },
    include: {
      resources: { include: { project: { include: { sources: true } } } },
      teams: { include: { team: true } }
    }
  });
}

export async function addResourceToGroup(tenantId: string, groupId: string, input: AddResourceGroupResourceBody) {
  const [group, project] = await Promise.all([
    prisma.resourceGroup.findFirst({ where: { id: groupId, tenantId }, select: { id: true } }),
    prisma.project.findFirst({ where: { id: input.project_id, tenantId }, select: { id: true } })
  ]);

  if (!group) return { error: 'GROUP_NOT_FOUND' as const };
  if (!project) return { error: 'PROJECT_NOT_FOUND' as const };

  const link = await prisma.resourceGroupResource.upsert({
    where: {
      resourceGroupId_projectId: {
        resourceGroupId: groupId,
        projectId: input.project_id
      }
    },
    create: {
      tenantId,
      resourceGroupId: groupId,
      projectId: input.project_id,
      role: input.role,
      weightMode: input.weight_mode,
      manualWeight: input.weight_mode === 'manual' ? input.manual_weight : null
    },
    update: {
      role: input.role,
      weightMode: input.weight_mode,
      manualWeight: input.weight_mode === 'manual' ? input.manual_weight : null
    },
    include: {
      project: {
        include: {
          sources: true,
          team: true
        }
      }
    }
  });

  return { data: link };
}

export async function removeResourceFromGroup(tenantId: string, groupId: string, projectId: string) {
  const deleted = await prisma.resourceGroupResource.deleteMany({
    where: {
      tenantId,
      resourceGroupId: groupId,
      projectId
    }
  });

  return deleted.count > 0;
}

export async function addTeamToGroup(tenantId: string, groupId: string, input: AddResourceGroupTeamBody) {
  const [group, team] = await Promise.all([
    prisma.resourceGroup.findFirst({ where: { id: groupId, tenantId }, select: { id: true } }),
    prisma.team.findFirst({ where: { id: input.team_id, tenantId }, select: { id: true } })
  ]);

  if (!group) return { error: 'GROUP_NOT_FOUND' as const };
  if (!team) return { error: 'TEAM_NOT_FOUND' as const };

  const link = await prisma.resourceGroupTeam.upsert({
    where: {
      resourceGroupId_teamId: {
        resourceGroupId: groupId,
        teamId: input.team_id
      }
    },
    create: {
      tenantId,
      resourceGroupId: groupId,
      teamId: input.team_id,
      role: input.role,
      allocationPercent: input.allocation_percent ?? null
    },
    update: {
      role: input.role,
      allocationPercent: input.allocation_percent ?? null
    },
    include: {
      team: true
    }
  });

  return { data: link };
}

export async function removeTeamFromGroup(tenantId: string, groupId: string, teamId: string) {
  const deleted = await prisma.resourceGroupTeam.deleteMany({
    where: {
      tenantId,
      resourceGroupId: groupId,
      teamId
    }
  });

  return deleted.count > 0;
}

export async function getResourceGroupMetricsSummary(tenantId: string, groupId: string) {
  const group = await prisma.resourceGroup.findFirst({
    where: { id: groupId, tenantId },
    include: {
      resources: {
        include: {
          project: {
            include: {
              sources: true
            }
          }
        }
      },
      teams: true
    }
  });

  if (!group) return null;

  const providerBreakdown: Record<string, number> = {};
  for (const link of group.resources) {
    for (const source of link.project.sources) {
      providerBreakdown[source.provider] = (providerBreakdown[source.provider] ?? 0) + 1;
    }
  }

  const weightModeBreakdown = group.resources.reduce(
    (acc, link) => {
      acc[link.weightMode] = (acc[link.weightMode] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const manualOverrides = group.resources.filter((r) => r.weightMode === 'manual').length;

  return {
    resource_group_id: group.id,
    resources_count: group.resources.length,
    teams_count: group.teams.length,
    providers_breakdown: providerBreakdown,
    weight_mode_breakdown: weightModeBreakdown,
    manual_overrides_count: manualOverrides,
    generated_at: new Date().toISOString()
  };
}
