import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  resourceGroupCalculationPolicy: {
    findMany: vi.fn(),
    findFirst: vi.fn()
  }
}));

vi.mock('../../lib/prisma.js', () => ({ prisma: mockPrisma }));

import { getNextCalculationPolicyVersion, resolveActiveCalculationPolicy } from './policy.service.js';

function makePolicy(overrides: Record<string, unknown> = {}) {
  return {
    id: 'policy-id',
    tenantId: 'ten_1',
    resourceGroupId: 'group_1',
    name: 'Default policy',
    status: 'active',
    version: 3,
    effectiveFrom: null,
    effectiveTo: null,
    config: { state_mapping: {} },
    createdAt: new Date('2026-06-08T10:00:00.000Z'),
    updatedAt: new Date('2026-06-08T10:00:00.000Z'),
    ...overrides
  };
}

describe('resolveActiveCalculationPolicy', () => {
  beforeEach(() => {
    mockPrisma.resourceGroupCalculationPolicy.findMany.mockReset();
  });

  it('prioriza policy ativa do resource group', async () => {
    mockPrisma.resourceGroupCalculationPolicy.findMany
      .mockResolvedValueOnce([
        makePolicy({ id: 'rg-policy', resourceGroupId: 'group_1', version: 4 })
      ])
      .mockResolvedValueOnce([
        makePolicy({ id: 'tenant-policy', resourceGroupId: null, version: 2 })
      ]);

    const result = await resolveActiveCalculationPolicy({
      tenantId: 'ten_1',
      resourceGroupId: 'group_1',
      at: new Date('2026-06-08T12:00:00.000Z')
    });

    expect(result.source).toBe('resource_group');
    expect(result.policy?.id).toBe('rg-policy');
    expect(mockPrisma.resourceGroupCalculationPolicy.findMany).toHaveBeenCalledTimes(1);
  });

  it('usa policy default do tenant quando nao existe policy ativa no resource group', async () => {
    mockPrisma.resourceGroupCalculationPolicy.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makePolicy({ id: 'tenant-policy', resourceGroupId: null, version: 2 })
      ]);

    const result = await resolveActiveCalculationPolicy({
      tenantId: 'ten_1',
      resourceGroupId: 'group_1',
      at: new Date('2026-06-08T12:00:00.000Z')
    });

    expect(result.source).toBe('tenant_default');
    expect(result.policy?.id).toBe('tenant-policy');
  });

  it('retorna fallback legacy quando nao existe policy ativa aplicavel', async () => {
    mockPrisma.resourceGroupCalculationPolicy.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await resolveActiveCalculationPolicy({
      tenantId: 'ten_1',
      resourceGroupId: 'group_1',
      at: new Date('2026-06-08T12:00:00.000Z')
    });

    expect(result.source).toBe('legacy');
    expect(result.policy).toBeNull();
  });

  it('ignora policy ativa fora da janela temporal', async () => {
    mockPrisma.resourceGroupCalculationPolicy.findMany
      .mockResolvedValueOnce([
        makePolicy({
          id: 'rg-future-policy',
          resourceGroupId: 'group_1',
          effectiveFrom: new Date('2026-07-01T00:00:00.000Z')
        })
      ])
      .mockResolvedValueOnce([
        makePolicy({ id: 'tenant-policy', resourceGroupId: null })
      ]);

    const result = await resolveActiveCalculationPolicy({
      tenantId: 'ten_1',
      resourceGroupId: 'group_1',
      at: new Date('2026-06-08T12:00:00.000Z')
    });

    expect(result.source).toBe('tenant_default');
    expect(result.policy?.id).toBe('tenant-policy');
  });
});

describe('getNextCalculationPolicyVersion', () => {
  beforeEach(() => {
    mockPrisma.resourceGroupCalculationPolicy.findFirst.mockReset();
  });

  it('incrementa a versao a partir da maior existente no escopo', async () => {
    mockPrisma.resourceGroupCalculationPolicy.findFirst.mockResolvedValueOnce({ version: 7 });

    const nextVersion = await getNextCalculationPolicyVersion({
      tenantId: 'ten_1',
      resourceGroupId: 'group_1'
    });

    expect(nextVersion).toBe(8);
  });

  it('inicia em 1 quando nao existe policy no escopo', async () => {
    mockPrisma.resourceGroupCalculationPolicy.findFirst.mockResolvedValueOnce(null);

    const nextVersion = await getNextCalculationPolicyVersion({
      tenantId: 'ten_1',
      resourceGroupId: null
    });

    expect(nextVersion).toBe(1);
  });
});
