# Guia de Reprocessamento — o que precisa de `POST /enrichment/:integrationId/run` e o que é sempre ao vivo

Referência única sobre um ponto que gera confusão recorrente: várias
configurações da plataforma (regras semânticas, vínculo de recurso a time)
só se aplicam a dado **já sincronizado** depois que alguém dispara
`POST /tenants/:tenantId/enrichment/:integrationId/run` de novo. Outras — os
gatilhos de DORA, a capacidade de membro de time, os aliases de identidade —
são sempre resolvidas ao vivo, a cada consulta, e nunca precisam disso. Este
documento existe pra não deixar cada feature nova reabrir essa investigação do
zero (foi como este documento nasceu: uma dúvida caso a caso sobre 7 pontos
diferentes, respondida lendo o código de verdade).

## A regra de ouro

Só existem **3 tabelas** que passam pela Enriched Layer e gravam um valor
calculado, congelado no momento do processamento:
`enriched_work_items`, `enriched_deployments`, `enriched_incidents`
(`EnrichmentService`, `src/enrichment/enrichment.service.ts`). Qualquer coisa
que essas 3 tabelas gravam só reflete configuração nova depois de um
reprocessamento. Qualquer coisa que **não** passa por elas — porque é lida
direto do canônico, ou porque nunca existiu uma tabela "enriquecida" pra essa
fonte — é sempre ao vivo.

**Pull Requests não têm Enriched Layer.** Não existe `enriched_pull_requests`
— confirmado no schema. Toda métrica de PR (`pullRequestReviewHealth`,
`contributionConcentration.pullRequests`, `reworkRate`, Lead Time com
`PR_OPENED`/`PR_MERGED`) resolve time via `JOIN team_resource_links`
**na hora da consulta**, em `TeamProfileService`/`PersonProfileService`. Isso
é o motivo de PRs serem a exceção mais importante da tabela abaixo.

## Tabela de referência

| O quê | Onde grava | Precisa reprocessar? |
| --- | --- | --- |
| `workItemType`, `workflowStates`, `deploymentEnvironment`, `incidentSeverity` (regras semânticas) | `enriched_work_items`/`enriched_deployments`/`enriched_incidents`, via `evaluateWorkItemType`/`evaluateWorkflowState`/`evaluateDeploymentEnvironment`/`evaluateIncidentSeverity` (`rule-evaluator.ts`), chamadas dentro de `EnrichmentService.enrich*` | **Sim** |
| `epicGrouping` | `enriched_work_items.epic_external_id`/`epic_external_name`/`is_epic_container`, via `resolveEpicGroup`/`evaluateIsEpicBoundary` dentro de `EnrichmentService.enrichWorkItem` (`enrichment.service.ts:399-413`) | **Sim** — não é resolvido na consulta, apesar do nome do endpoint (`/profile/epics`) sugerir isso. `TeamProfileService.getEpicBreakdown`/`PersonProfileService.getEpicBreakdown` só fazem `SELECT epic_external_id FROM enriched_work_items`, sem recalcular nada. |
| Vínculo de recurso a time — **work items, deploys, incidentes** (`team_resource_links` ou `teamId` direto na integração) | `enriched_*.team_id`, via `resolvedTeamId = externalGroupMap.get(...) ?? fallbackTeamId` dentro de cada `EnrichmentService.run*Enrichment` | **Sim**, nos dois modos — tanto o vínculo pós-sync (`team_resource_links`) quanto o modo escopado direto (`PATCH .../integrations/:integrationId` com `teamId`). Os dois alimentam o mesmo `fallbackTeamId`/`externalGroupMap`, congelado por linha no momento do enrichment. |
| Vínculo de recurso a time — **Pull Requests** | Nunca grava — `JOIN team_resource_links` ao vivo em toda query de PR (`team-profile.service.ts`, `person-profile.service.ts`) | **Não.** Reflete na próxima consulta, sem nenhuma ação. |
| Gatilhos de DORA (`metric_triggers` — `deploymentFrequency`/`leadTime`/`meanTimeToRestore`/`changeFailureRate`) | Nunca grava — `DashboardService.query*` lê `canonical_*`/`enriched_*` direto por SQL a cada chamada, com o gatilho resolvido na hora (`MetricTriggerConfigRepository`) | **Não.** Nenhuma das 4 métricas depende de uma coluna que só existe por causa do gatilho escolhido — todas usam timestamps que já existem independente da config. |
| Capacidade de membro de time (`capacityAllocationPercent`, `customMonthlyCapacityHours`, `roleInTeam`) | Nunca grava fora de `team_memberships` — `TeamProfileService.computeToilRatio`/`PersonProfileService.getProfile` recalculam a partir do roster buscado fresco a cada `GET .../profile` | **Não.** `roleInTeam` hoje nem entra em cálculo nenhum, só é exibido. |
| Aliases de identidade (`user_provider_aliases`, `POST`/`DELETE .../users/:userId/aliases`) | Nunca grava um `userId` resolvido em `canonical_*`/`enriched_*` — `assignee_external_id`/`author_external_id`/`triggered_by_external_id` são sempre o id cru do provider; a resolução pra pessoa é sempre um `JOIN` feito na leitura | **Não.** Criar/apagar um alias reflete no próximo `GET .../profile` imediatamente, inclusive sobre histórico já sincronizado há muito tempo. |

## Duas pegadinhas de escopo, não só "sim/não"

### 1. `POST .../enrichment/:integrationId/run` reprocessa o **provider inteiro** pra CI/CD e Incidentes, não só a integração da URL

`EnrichmentService.runForIntegration` despacha por categoria
(`enrichment.service.ts:103-115`), e duas das três categorias buscam por
**provider**, não pela integração que disparou a chamada:

- `runDeploymentEnrichment` (`cicd` — GitHub Actions/ArgoCD/Azure Pipelines):
  `this.deploymentRepository.findByProvider(tenantId, integration.provider)`.
- `runIncidentEnrichment` (`incident` — Waroom): idem,
  `this.incidentRepository.findByProvider(...)`.
- `runWorkItemEnrichment` (`issue_tracker` — Jira/Linear/Azure Boards) é a
  única que fica de fato restrita: `this.workItemRepository.findByIntegration(tenantId, integration.id)`.

Motivo (documentado no próprio código): resolução de time nesses dois casos
já é por registro individual via `team_resource_links`, então processar
todas as integrações daquele provider de uma vez é seguro e idempotente —
foi uma escolha deliberada de simplicidade, não um bug. Na prática: chamar
o endpoint com o `id` de **qualquer** integração `cicd`/`incident` do tenant
reprocessa **todo** deploy/incidente daquele provider, de todas as
integrações. Só `issue_tracker` fica realmente isolado à integração da URL.

### 2. Mudança de regra no nível de organização — dá pra saber de antemão quem é afetado

A precedência é **tudo-ou-nada por nível**, não por família de regra
(`MappingRulesRepository.getEffectiveRules`,
`src/enrichment/mapping-rules.repository.ts:93-117`): se um time tem
**qualquer** linha própria em `team_metric_configurations` com
`rules IS NOT NULL`, essa linha vence **inteira** sobre a organização — não
existe merge parcial por família (`workItemType`/`epicGrouping`/etc). Um
time com override só de `workItemType` já fica imune a uma mudança de
`deploymentEnvironment` da organização, porque o objeto inteiro de `rules`
daquele time é usado, não campo a campo.

Isso significa que o alcance de "quem precisa reprocessar" depois de uma
mudança de organização é conhecido **sem** rodar nada: cruzar os times que
cada integração resolve (via `team_resource_links` + `teamId` direto) contra
quais desses times têm override próprio (`rules IS NOT NULL` em
`team_metric_configurations` — `getTeamRules`, leitura crua, sem fallback).
Toda integração cujo dado resolve, mesmo que parcialmente, pra um time
**sem** override (ou pra `team_id: null`) precisa reprocessar depois de uma
mudança de organização.

**Regra de time vazia (não removida) conta como override** — pegadinha real,
já causou incidente em produção. Salvar uma regra de time com tudo vazio
(`workItemType: []`, etc.) ainda deixa `rules IS NOT NULL` naquela linha —
pra fins de precedência, isso **bloqueia organização por inteiro**, do
mesmo jeito que uma regra de time completa bloquearia. Não existia jeito de
desfazer isso até `DELETE /tenants/:tenantId/teams/:teamId/mapping-rules`/
`DELETE /tenants/:tenantId/mapping-rules` (e o par equivalente em
`/metric-triggers`) — antes, "deletar" pela tela só reenviava um `POST`
vazio, que não resolve porque vazio ainda é "tem override". Apagar de
verdade (`rules` volta a `NULL`) também **não é retroativo** — é a mesma
categoria da linha 35 da tabela acima, precisa de
`POST .../enrichment/:integrationId/run` depois pra refletir no dado já
sincronizado.

## Limite conhecido, à parte (não é sobre reprocessamento)

`resolveEpicGroup` (`src/enrichment/epic-resolver.ts`) só sobe a cadeia de
`parentExternalId` **dentro da mesma integração** — um item cujo pai/épico
está em outro projeto/integração nunca resolve, reprocessar não muda isso
(gap já registrado em `docs/BACKLOG.md`).
