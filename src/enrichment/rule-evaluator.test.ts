import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateDeploymentEnvironment,
  evaluateIncidentSeverity,
  evaluateWorkItemType,
  evaluateWorkflowState,
} from './rule-evaluator';
import type { MappingRules } from './domain-context.types';

const EMPTY_RULES: MappingRules = {
  workItemType: [],
  workflowStates: [],
  deploymentEnvironment: [],
  incidentSeverity: [],
};

describe('evaluateWorkItemType', () => {
  it('classifica pelo issue_type com operador IN', () => {
    const rules: MappingRules = {
      ...EMPTY_RULES,
      workItemType: [
        {
          targetCategory: 'BUG',
          matchMode: 'ANY',
          conditions: [{ field: 'issue_type', operator: 'IN', values: ['Bug'] }],
        },
      ],
    };

    assert.equal(evaluateWorkItemType('Bug', [], rules), 'BUG');
  });

  it('classifica pela label com CONTAINS_ANY', () => {
    const rules: MappingRules = {
      ...EMPTY_RULES,
      workItemType: [
        {
          targetCategory: 'TOIL',
          matchMode: 'ANY',
          conditions: [{ field: 'labels', operator: 'CONTAINS_ANY', values: ['toil'] }],
        },
      ],
    };

    assert.equal(evaluateWorkItemType('Task', ['toil', 'urgent'], rules), 'TOIL');
  });

  it('matchMode ALL exige que todas as condições batam', () => {
    const rules: MappingRules = {
      ...EMPTY_RULES,
      workItemType: [
        {
          targetCategory: 'RISK',
          matchMode: 'ALL',
          conditions: [
            { field: 'issue_type', operator: 'IN', values: ['Bug'] },
            { field: 'labels', operator: 'CONTAINS_ANY', values: ['security'] },
          ],
        },
      ],
    };

    assert.equal(evaluateWorkItemType('Bug', ['security'], rules), 'RISK');
    // Só uma das duas condições bate -> ALL falha -> cai no fallback.
    assert.equal(evaluateWorkItemType('Bug', ['ui'], rules), 'FEATURE');
  });

  it('é case-insensitive', () => {
    const rules: MappingRules = {
      ...EMPTY_RULES,
      workItemType: [
        {
          targetCategory: 'BUG',
          matchMode: 'ANY',
          conditions: [{ field: 'issue_type', operator: 'IN', values: ['BUG'] }],
        },
      ],
    };

    assert.equal(evaluateWorkItemType('bug', [], rules), 'BUG');
  });

  it('cai no fallback FEATURE quando nenhuma regra bate', () => {
    assert.equal(evaluateWorkItemType('Story', [], EMPTY_RULES), 'FEATURE');
  });

  it('primeira regra que bate vence, na ordem declarada', () => {
    const rules: MappingRules = {
      ...EMPTY_RULES,
      workItemType: [
        {
          targetCategory: 'BUG',
          matchMode: 'ANY',
          conditions: [{ field: 'issue_type', operator: 'IN', values: ['Task'] }],
        },
        {
          targetCategory: 'TECHNICAL_DEBT',
          matchMode: 'ANY',
          conditions: [{ field: 'issue_type', operator: 'IN', values: ['Task'] }],
        },
      ],
    };

    assert.equal(evaluateWorkItemType('Task', [], rules), 'BUG');
  });
});

describe('evaluateWorkflowState', () => {
  it('classifica por rawStatusValues, case-insensitive', () => {
    const rules: MappingRules = {
      ...EMPTY_RULES,
      workflowStates: [{ targetState: 'IN_PROGRESS', isActiveTime: true, rawStatusValues: ['Doing'] }],
    };

    assert.deepEqual(evaluateWorkflowState('doing', rules), { state: 'IN_PROGRESS', isActiveTime: true });
  });

  it('cai no fallback BACKLOG/false quando nenhum status bate', () => {
    assert.deepEqual(evaluateWorkflowState('Unknown Status', EMPTY_RULES), {
      state: 'BACKLOG',
      isActiveTime: false,
    });
  });
});

describe('evaluateDeploymentEnvironment', () => {
  it('classifica ambiente pelo operador IN', () => {
    const rules: MappingRules = {
      ...EMPTY_RULES,
      deploymentEnvironment: [
        {
          targetEnvironment: 'PRODUCTION',
          matchMode: 'ANY',
          conditions: [{ field: 'environment', operator: 'IN', values: ['prod'] }],
        },
      ],
    };

    assert.equal(evaluateDeploymentEnvironment('prod', rules), 'PRODUCTION');
  });

  it('cai no fallback OTHER quando nenhuma regra bate', () => {
    assert.equal(evaluateDeploymentEnvironment('github-pages', EMPTY_RULES), 'OTHER');
  });

  it('não estoura com JSONB legado sem a chave deploymentEnvironment (bug real já corrigido em produção)', () => {
    // Reproduz o formato salvo em team_metric_configurations por uma rodada
    // anterior, antes de deploymentEnvironment/incidentSeverity existirem.
    const legacyRules = { workItemType: [], workflowStates: [] } as unknown as MappingRules;

    assert.equal(evaluateDeploymentEnvironment('production', legacyRules), 'OTHER');
  });
});

describe('evaluateIncidentSeverity', () => {
  it('classifica severidade pelo operador IN', () => {
    const rules: MappingRules = {
      ...EMPTY_RULES,
      incidentSeverity: [
        {
          targetClassification: 'COUNTS_AS_FAILURE',
          matchMode: 'ANY',
          conditions: [{ field: 'severity', operator: 'IN', values: ['SEV1'] }],
        },
      ],
    };

    assert.equal(evaluateIncidentSeverity('SEV1', rules), 'COUNTS_AS_FAILURE');
  });

  it('cai no fallback INFORMATIONAL quando nenhuma regra bate', () => {
    assert.equal(evaluateIncidentSeverity('SEV4', EMPTY_RULES), 'INFORMATIONAL');
  });

  it('não estoura com JSONB legado sem a chave incidentSeverity (bug real já corrigido em produção)', () => {
    const legacyRules = { workItemType: [], workflowStates: [] } as unknown as MappingRules;

    assert.equal(evaluateIncidentSeverity('SEV1', legacyRules), 'INFORMATIONAL');
  });
});
