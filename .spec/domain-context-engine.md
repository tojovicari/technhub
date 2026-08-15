# Mapeamento Semântico (Domain Context Engine)

Parte de [spec-engineering-intelligence.md](./spec-engineering-intelligence.md) (índice) — Seções 1 e 2 (Visão Geral, Ecossistema de Origens) ficam lá; o resto foi quebrado por tópico neste diretório.

## 3. Mapeamento Semântico (Domain Context Engine)

Como cada time utiliza as ferramentas de maneira distinta, o sistema adota um motor de regras semânticas com 3 níveis de precedência: Configuração do Time > Configuração da Organização > Fallback Padrão do Sistema.

**Quando uma regra muda, o efeito nem sempre é retroativo — ver `docs/reprocessing-guide.md`.** As 4 famílias desta seção (`work_item_type`/`workflow_states`/`deployment_environment`/`incident_severity`) mais `epic_grouping` são gravadas por linha na Enriched Layer no momento do processamento (`EnrichmentService`), não recalculadas na leitura — precisam de `POST .../enrichment/:integrationId/run` pra refletir em dado já sincronizado. Gatilhos de DORA (Seção 6), capacidade de membro de time e aliases de identidade são o oposto: sempre resolvidos ao vivo, nunca precisam disso.

### 3.1. Estrutura do JSON de Regras (mapping_rules)

{
"tenant_id": "org_123",
"team_id": "squad_checkout",
"updated_at": "2026-07-21T09:30:00Z",
"rules": {
"work_item_type": [
{
"target_category": "BUG",
"match_mode": "ANY",
"conditions": [
{ "field": "issue_type", "operator": "IN", "values": ["Bug", "Defect"] },
{ "field": "labels", "operator": "CONTAINS_ANY", "values": ["bugfix", "prod-issue"] }
]
},
{
"target_category": "TECHNICAL_DEBT",
"match_mode": "ANY",
"conditions": [
{ "field": "issue_type", "operator": "EQUALS", "values": ["Technical Debt"] },
{ "field": "labels", "operator": "CONTAINS_ANY", "values": ["debt", "refactor", "chore"] }
]
},
{
"target_category": "TOIL",
"match_mode": "ANY",
"conditions": [
{ "field": "issue_type", "operator": "EQUALS", "values": ["Ops Task"] },
{ "field": "labels", "operator": "CONTAINS_ANY", "values": ["toil", "manual-ops", "access-request"] }
]
}
],
"workflow_states": [
{
"target_state": "IN_PROGRESS",
"is_active_time": true,
"raw_status_values": ["In Dev", "Doing", "In Progress"]
},
{
"target_state": "WAITING_REVIEW",
"is_active_time": false,
"raw_status_values": ["In Review", "Waiting QA", "PR Opened"]
},
{
"target_state": "DONE",
"is_active_time": false,
"raw_status_values": ["Closed", "Merged", "Done"]
}
]
}
}

**Nota**: o JSON acima é ilustrativo, não exaustivo — `mapping_rules` também tem as famílias `deploymentEnvironment` (ambiente semântico de deploy), `incidentSeverity` (classificação de Change Failure) e `epicGrouping` (fronteira de agrupamento de nível épico, ver Seção 5 — `enriched_work_items.epic_external_id`). `epicGrouping` não classifica nada, só responde "esse item é ele mesmo um épico/feature/container?" (mesmo shape de `workItemType`, sem `target_category`) — usado por `src/enrichment/epic-resolver.ts` pra parar de subir a cadeia de `parentExternalId` (Jira/Azure Boards; Linear resolve direto via Project, sem passar por essa checagem — ver Seção 5).

