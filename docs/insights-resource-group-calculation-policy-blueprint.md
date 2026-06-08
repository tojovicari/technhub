# Plano Faseado - Politica de Calculo por Resource Group (Insights)

Data: 2026-06-08
Status: fase 3 implementada no backend; aguardando validacao frontend para avancar
Escopo: Insights + DORA (calculo orientado por configuracao, sem alterar COGS/SLA)

## 1. Objetivo

Integrar ao modulo de Insights uma politica configuravel por Resource Group para controlar:

1. Mapeamento de status externos para estados canonicos.
2. Selecao e agregacao de fontes de entrega.
3. Parametros de tuning de calculo em metricas do proprio modulo.

## 2. Baseline atual (ja implementado)

1. Endpoints de Insights ativos: overview, incidents, planning-confidence, backlog-quality, trends e recompute.
2. Calculo atual usa regras legadas fixas no service.
3. Snapshot e freshness ativos no modulo.
4. Sem politica configuravel por Resource Group em runtime.

## 3. Principios e guardrails

1. Contract-first: contratos de API e payload versionado antes da logica final.
2. Fallback seguro: sem policy ativa, comportamento legado continua igual.
3. Explainability obrigatoria em todas as respostas de Insights.
4. Auditoria completa: versao, autor, data e diff da policy.
5. Sem mutacao direta entre modulos; uso apenas de contratos e entidades do proprio modulo.

## 4. Modelo de configuracao alvo

Entidade alvo: ResourceGroupCalculationPolicy

Campos principais:

1. id
2. tenantId
3. resourceGroupId (nullable para default do tenant)
4. name
5. status (draft|active|archived)
6. version
7. effectiveFrom
8. effectiveTo
9. config (json)
10. createdBy
11. updatedBy
12. createdAt
13. updatedAt

## 5. Fases de implementacao

## Fase 0 - Contrato e governanca

Objetivo:

1. Fechar contrato publico da policy e regras de permissao.

Entregaveis:

1. Atualizacao do OpenAPI de Insights com endpoints de policy.
2. Definicao de permissoes: insights.policy.read, insights.policy.write, insights.policy.publish.
3. Documento de compatibilidade e fallback (sem breaking change).

Criterios de aceite:

1. Contrato revisado e versionado.
2. Testes de contrato cobrindo 200, 400, 401, 403, 404 e 409.

## Fase 1 - Persistencia e versionamento de policy

Objetivo:

1. Introduzir armazenamento da policy por Resource Group e default por tenant.

Entregaveis:

1. Modelagem Prisma para ResourceGroupCalculationPolicy.
2. Migracao com indices para busca por tenantId/resourceGroupId/status/effectiveFrom.
3. Repositorio e service para resolver policy ativa por precedencia.

Criterios de aceite:

1. Resolver precedencia corretamente: Resource Group ativa > Tenant default ativa > Legacy fallback.
2. Publicacao bloqueada quando houver conflito de periodo.

Status de execucao:

1. concluida no backend em 2026-06-08 (modelagem Prisma, migracao e service de resolucao)
2. handover frontend emitido para validacao de impacto contratual
3. proxima fase bloqueada ate aprovacao explicita do ciclo de testes

## Fase 2 - API de policy (draft, publish, history)

Objetivo:

1. Expor ciclo de vida da policy sem ainda mudar todos os calculos.

Entregaveis:

1. GET policy ativa.
2. PUT policy draft.
3. POST publish.
4. GET history.

Criterios de aceite:

1. Validacao de mapeamento sem sobreposicao de status externos entre estados canonicos.
2. Auditoria gravada em toda alteracao.
3. Cobertura minima de mapeamento validada para publish (threshold configuravel, default 80%).

Status de execucao:

1. concluida no backend em 2026-06-08 (rotas GET/PUT/POST publish/GET history)
2. testes de contrato e build validados
3. handover frontend emitido para implementacao da fase
4. proxima fase bloqueada ate aprovacao explicita do ciclo de testes

## Fase 3 - Integracao de calculo no modulo Insights

Objetivo:

1. Aplicar policy no runtime das metricas, mantendo fallback legado.

Entregaveis:

1. Overview: throughput por delivery.sources + aggregation_mode + tuning overview.
2. Trends: throughput/confidence calculados sobre fonte agregada configurada.
3. Backlog Quality: classificacao por state_mapping e pesos por metric_tuning.backlog_quality.
4. Planning Confidence: open_ratio orientado por estados configurados.
5. Inclusao de calculation_context nas respostas dos endpoints impactados.

Criterios de aceite:

1. Sem policy ativa, numeros permanecem equivalentes ao comportamento legado dentro da tolerancia esperada.
2. Com policy ativa, calculation_context informa policy_source, policy_id, policy_version e fallback_used.
3. Testes de regressao validam cenarios com e sem policy.

Status de execucao:

1. concluida no backend em 2026-06-08 (runtime aplicado em overview, trends, backlog-quality e planning-confidence)
2. calculation_context incluido nas respostas dos endpoints impactados
3. contrato OpenAPI atualizado para refletir os novos campos
4. proxima fase bloqueada ate aprovacao explicita do ciclo de testes e handover frontend

## Fase 4 - Simulacao e hardening

Objetivo:

1. Reduzir risco de publicacao e aumentar previsibilidade de impacto.

Entregaveis:

1. Endpoint de simulacao (delta vs policy ativa).
2. Relatorio de cobertura e status nao mapeados.
3. Warnings de qualidade e normalizacao de pesos quando necessario.
4. effectiveFrom/effectiveTo para cutover controlado.

Criterios de aceite:

1. Simulacao retorna delta de metricas e warnings de risco.
2. Publicacao condicionada ao resultado minimo de qualidade definido no contrato.

## Fase 5 - Worker e jobs assincronos

Objetivo:

1. Garantir processamento confiavel de recompute/simulacao/publicacao em execucao assincrona.

Entregaveis:

1. Fila persistente para jobs de insights policy (recompute, simulate, publish).
2. Worker dedicado com idempotencia por chave de job e lock de concorrencia por resource group.
3. Retentativas com backoff, dead-letter e trilha de erro estruturada.
4. Estado de job consultavel por API (queued, running, succeeded, failed, dead_letter).
5. Estrategia operacional para Fly com processo de worker separado do processo web.

Criterios de aceite:

1. Jobs sobrevivem a restart de instancia sem perda de rastreabilidade.
2. Mesma requisicao nao duplica efeito em cenarios de retry.
3. Publicacao/recompute concorrentes no mesmo resource group respeitam lock e retornam conflito quando necessario.
4. Existe runbook de operacao para incidente de fila/worker (incluindo rollback).

## Fase 6 - Operacao e rollout controlado

Objetivo:

1. Entrar em producao com rollout progressivo por tenant/resource group.

Entregaveis:

1. Feature flag por tenant para habilitar engine configuravel.
2. Dashboards de observabilidade para latencia/erro/fallback_used.
3. Plano de rollback para politica ativa e para engine configuravel.

Criterios de aceite:

1. Rollout iniciado em canary sem regressao critica.
2. Fallback e rollback validados em ambiente de homologacao.

## 6. Estrutura do config (referencia)

```json
{
  "state_mapping": {
    "backlog": [
      { "provider": "jira", "source_type": "issue", "match": "To Do" }
    ],
    "planned": [
      {
        "provider": "jira",
        "source_type": "issue",
        "match": "Selected for Development"
      }
    ],
    "in_progress": [
      { "provider": "jira", "source_type": "issue", "match": "In Progress" },
      { "provider": "github", "source_type": "pr", "match": "open" }
    ],
    "paused": [
      { "provider": "jira", "source_type": "issue", "match": "Blocked" }
    ],
    "done": [
      { "provider": "jira", "source_type": "issue", "match": "Done" },
      { "provider": "github", "source_type": "pr", "match": "merged" }
    ],
    "cancelled": [
      { "provider": "jira", "source_type": "issue", "match": "Won't Do" }
    ]
  },
  "delivery": {
    "sources": ["task_done", "pr_merged", "release_deploy"],
    "aggregation_mode": "weighted",
    "weights": {
      "task_done": 0.5,
      "pr_merged": 0.3,
      "release_deploy": 0.2
    },
    "dedup": {
      "enabled": true,
      "key_strategy": "task_source_or_pr_or_release"
    }
  },
  "metric_tuning": {
    "overview": {
      "incident_penalty_cap": 40,
      "throughput_penalty_down": 15,
      "throughput_penalty_stable": 6
    },
    "backlog_quality": {
      "weights": {
        "stale_backlog_rate": 40,
        "overdue_backlog_rate": 25,
        "flow_regression_rate": 20,
        "backlog_churn_proxy": 15
      }
    }
  }
}
```

Notas:

1. match pode ser literal, regex ou lista (detalhar no contrato final).
2. weights fora de 1.0 devem ser normalizados com warning.

## 7. Explainability obrigatoria

Toda resposta de Insights impactada por policy deve expor calculation_context:

```json
{
  "calculation_context": {
    "policy_source": "resource_group",
    "policy_id": "...",
    "policy_version": 3,
    "delivery_sources_used": ["task_done", "pr_merged"],
    "aggregation_mode": "weighted",
    "state_mapping_hash": "sha256:...",
    "fallback_used": false,
    "warnings": []
  }
}
```

## 8. Riscos e mitigacoes

1. Risco: configuracao complexa para squads.
2. Mitigacao: templates por provider e validacao guiada antes de publish.
3. Risco: metricas instaveis por mapeamento ruim.
4. Mitigacao: simulacao obrigatoria e cobertura minima para publicar.
5. Risco: impacto de performance por regras dinamicas.
6. Mitigacao: cache da policy ativa por Resource Group e snapshot lineage.
7. Risco: jobs pausarem em ambiente com autoscale agressivo e sem worker dedicado sempre ativo.
8. Mitigacao: separar processo worker, usar fila persistente e definir politica minima de disponibilidade para o worker.

## 9. Definition of done do plano

1. Policy ativa aplicada em runtime nos endpoints de Insights definidos na Fase 3.
2. Contratos e testes de permissao/validacao completos.
3. Explainability ativa com calculation_context.
4. Simulacao e publish com governanca e auditoria.
5. Worker/job assincrono com idempotencia, retry e status consultavel.
6. Rollout controlado com observabilidade e rollback.
