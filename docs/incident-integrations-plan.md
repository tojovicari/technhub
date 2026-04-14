# Plano de Integração: OpsGenie + incident.io

> Status: **✅ concluído** | Iniciado: 2026-04-14 | Fase alvo: 2.5 (antecipando item 4.11 do roadmap)

---

## Contexto e Motivação

### Problema atual com o MTTR

O DORA MTTR hoje é calculado a partir de tasks JIRA do tipo `bug` com prioridade P0/P1:

```
MTTR = percentil 50 de (completed_at - created_at) por bug crítico
```

**Limitações graves e insuperáveis:**
- O ticket JIRA geralmente é aberto *depois* que o incidente foi detectado (delay de minutos a horas)
- Fechamento da task nem sempre coincide com a restauração do serviço
- Incidentes não trackeados como bugs ficam fora do cálculo
- Não há granularidade por serviço afetado
- Imprecisão de 20–60% estimada no MTTR reportado

> **Decisão:** MTTR via JIRA está sendo descontinuado. O cálculo passa a depender exclusivamente de uma integração de incident management (OpsGenie ou incident.io). Tenants sem essa integração terão MTTR como `null` — é preferível não reportar a reportar errado.

### O que integrações de incident management resolvem

Ferramentas como **OpsGenie** e **incident.io** são a fonte autoritativa de incidentes de produção — elas capturam timestamps precisos do ciclo de vida completo:

| Evento               | OpsGenie                          | incident.io                |
|----------------------|-----------------------------------|----------------------------|
| Incidente detectado  | `createdAt` (Alert) / `impactStartDate` (Incident) | `created_at` |
| Responder acionado   | `report.ackTime` offset           | `acknowledged_at`          |
| Incidente resolvido  | `impactEndDate` / `report.closeTime` | `resolved_at`           |
| Serviço afetado      | `impactedServices[]`              | `incident_role`, severity  |
| Prioridade           | P1–P5                             | severity (Critical/Major…) |

---

## Novas Métricas Habilitadas

### MTTR (Mean Time to Restore) — precisão substancialmente maior

```
MTTR = percentil 50 de (resolved_at - created_at) por incidente P1/P2
```

Antes: heurística via bug JIRA | Depois: timestamp exato de abertura e resolução.

### MTTA (Mean Time to Acknowledge) — **métrica nova**

```
MTTA = percentil 50 de (acknowledged_at - created_at) por incidente P1/P2
```

Indica a velocidade de resposta do time de on-call. Não existe hoje.

### Incident Frequency — **métrica nova**

```
incident_frequency = count(incidentes P1/P2) / dias na janela
```

Equivalente ao Deployment Frequency mas para falhas. Complementa o CFR.

### Change Failure Rate (CFR) — correlação aprimorada

Hoje o CFR usa heurística (bug aberto em < 24h após deploy). Com incidentes reais, podemos correlacionar `incident.created_at` com o deploy mais recente de forma muito mais confiável.

---

## Análise dos Providers

### OpsGenie

**APIs relevantes:**
- Alert API: `GET /v2/alerts` — alertas com `report.ackTime`, `report.closeTime`
- Incident API: `GET /v1/incidents` — incidentes gerenciados (Standard/Enterprise)
- Webhook integration: envio em tempo real de eventos de alerta/incidente

**Campos-chave para MTTR:**

```json
// GET /v1/incidents/:id
{
  "id": "uuid",
  "status": "closed",
  "priority": "P1",
  "createdAt": "2026-04-14T10:00:00Z",
  "impactStartDate": "2026-04-14T09:58:00Z",
  "impactDetectDate": "2026-04-14T10:00:00Z",
  "impactEndDate": "2026-04-14T11:23:00Z",
  "impactedServices": ["service-uuid-1"],
  "responders": [{"type": "team", "id": "team-uuid"}],
  "tags": ["production", "database"]
}
```

**Autenticação:** `GenieKey <api_key>` no header `Authorization`  
**Rate limit:** não documentado publicamente; prática comum: 5–10 req/s  
**Sync mode:** Pull (incremental por `updatedAt`) + Webhook push  
**Restrição importante:** Incident API requer plano Standard ou Enterprise

**Fallback para plano Essentials:**  
Usar Alert API com filtro `priority:p1 OR priority:p2` — menos estruturado mas acessível em todos os planos.

---

### incident.io

**APIs relevantes:**
- `GET /v2/incidents` — lista de incidentes com status e severity
- `GET /v2/incidents/:id/updates` — timeline de status transitions (precisa para MTTA)
- Webhooks: `incident.created`, `incident.updated`, `incident.resolved`

**Campos-chave para MTTR:**

```json
// GET /v2/incidents/:id
{
  "id": "01abc...",
  "name": "Database latency spike",
  "status": "resolved",
  "severity": {
    "name": "Critical",
    "rank": 1
  },
  "created_at": "2026-04-14T09:58:00Z",
  "updated_at": "2026-04-14T11:23:00Z",
  "resolved_at": "2026-04-14T11:23:00Z",
  "incident_roles": [...],
  "custom_fields": [...]
}
```

**Autenticação:** `Bearer <api_key>` no header `Authorization`  
**Rate limit:** 1200 req/min (bem documentado)  
**Sync mode:** Pull (incremental por `updated_at`) + Webhook push  
**Diferencial:** timeline de status muito estruturada; foco em incident management formal; postmortems integrados

---

## Comparação: OpsGenie vs incident.io

| Aspecto                          | OpsGenie                          | incident.io              |
|----------------------------------|-----------------------------------|--------------------------|
| Foco principal                   | Alerting + On-call routing        | Incident management      |
| MTTR disponível nativamente      | Sim (report.closeTime)            | Sim (resolved_at)        |
| MTTA disponível                  | Sim (report.ackTime)              | Via status updates       |
| Granularidade de serviço         | impactedServices (list de IDs)    | Via custom fields        |
| Postmortems estruturados         | Básico                            | Nativo e detalhado       |
| Webhook support                  | Sim                               | Sim                      |
| Plano mínimo para Incident API   | Standard/Enterprise               | Qualquer plano           |
| Adoção no mercado                | Muito ampla (Atlassian)           | Crescente, mais moderno  |
| Integração com Atlassian (JIRA)  | Nativa                            | Disponível               |

**Recomendação:** implementar ambos como conectores independentes. São complementares — alguns clientes usam OpsGenie para alerting e incident.io para gestão do incidente.

**Ordem de implementação:** incident.io primeiro (API mais simples, sem restrição de plano). A camada de normalização (field mapping) é projetada como conceito compartilhado desde o início — os dois connectors consomem a mesma interface de configuração de campos.

---

## Design Técnico

### Modelo de Dados — nova entidade `IncidentEvent`

O `IncidentEvent` é a entidade normalizada que representa um incidente de produção, independente do provider. Owned pelo módulo de Integrations.

```
IncidentEvent {
  id               String    (uuid, PK)
  tenantId         String
  connectionId     String    (FK → IntegrationConnection)
  provider         Enum      (opsgenie | incident_io)
  externalId       String    (ID no provider)

  // Ciclo de vida — campos-chave para MTTR/MTTA
  openedAt         DateTime  (quando o incidente foi detectado/criado)
  acknowledgedAt   DateTime? (quando o primeiro responder atuou — MTTA)
  resolvedAt       DateTime? (quando o serviço foi restaurado — MTTR)
  closedAt         DateTime? (encerramento formal, pode diferir do resolved)

  // Classificação
  priority         String?   (P1, P2, P3…  normalizado cross-provider)
  severity         String?   (nome do nível de severidade do provider)
  status           Enum      (open | acknowledged | resolved | closed)
  title            String

  // Contexto
  affectedServices String[]  (nomes/IDs dos serviços afetados)
  responderIds     String[]  (IDs dos responders do provider)
  tags             String[]

  // Auditoria
  rawPayload       Json?
  syncedAt         DateTime

  @@unique([tenantId, provider, externalId])
}
```

### Alteração no schema Prisma

```
// prisma/schema.prisma
enum IntegrationProvider {
  jira
  github
  opsgenie         // NOVO
  incident_io      // NOVO
}
```

Nova migration: `add_incident_event_and_new_providers`

---

### Connectors

Dois novos connectors, seguindo exatamente o padrão `IntegrationConnector`:

```
integrations/
└── connectors/
    ├── base.ts               (interface existente — sem alteração)
    ├── jira.ts
    ├── github.ts
    ├── opsgenie.ts           ← NOVO
    └── incident_io.ts        ← NOVO
```

**OpsGenie Connector:**
- `runSync`: pull incremental via `GET /v1/incidents?query=status:closed&sort=updatedAt&order=asc` com `sinceDate`
- Fallback para Alert API se plano Essentials
- Transform: `OpsGenieIncident → IncidentEvent`
- `webhookConfig.eventTypeHeader`: `X-OG-Event-Type`

**incident.io Connector:**
- `runSync`: pull incremental via `GET /v2/incidents?updated_at[gte]=sinceDate`
- Transform: `IncidentIoIncident → IncidentEvent`
- `webhookConfig.eventTypeHeader`: `X-Incident-Io-Event-Type`

### Configuração de Campos (Field Mapping)

Cada organização configura seu incident management de forma diferente: nomes de severity, campos customizados para serviço afetado, quais tags identificam um incidente de produção, qual timestamp marca o início real do incidente. Sem um mecanismo de field mapping, a normalização estará errada para a maioria dos tenants.

O field mapping é armazenado como parte do `scope` da `IntegrationConnection` e é resolvido pelo transformer antes de produzir o `IncidentEvent`. A interface é agnóstica de provider — ambos os connectors usam o mesmo contrato de configuração.

**Schema do field mapping (dentro de `scope`):**

```json
// Exemplo: incident.io com nomes de severity customizados
{
  "field_mapping": {
    "severity_to_priority": {
      "SEV1": "P1",
      "SEV2": "P2",
      "SEV3": "P3",
      "SEV4": "P4"
    },
    "production_indicator": {
      "type": "tag",
      "values": ["production", "prod", "prd"]
    },
    "affected_service_field": {
      "type": "custom_field",
      "field_id": "01CUSTOM_FIELD_ID"
    },
    "opened_at_field": "created_at",
    "include_priorities": ["P1", "P2"]
  }
}
```

```json
// Exemplo: OpsGenie com priority nativa P1-P5
{
  "field_mapping": {
    "severity_to_priority": {
      "P1": "P1",
      "P2": "P2",
      "P3": "P3",
      "P4": "P4",
      "P5": "P5"
    },
    "production_indicator": {
      "type": "tag",
      "values": ["production"]
    },
    "affected_service_field": {
      "type": "impacted_services"
    },
    "opened_at_field": "impactStartDate",
    "include_priorities": ["P1", "P2"]
  }
}
```

**Campos configuráveis:**

| Campo                    | Descrição                                                                 | Default                            |
|--------------------------|---------------------------------------------------------------------------|------------------------------------|
| `severity_to_priority`   | Mapa de nome de severity do provider → P1-P5 normalizado                 | Obrigatório na criação             |
| `production_indicator`   | Como identificar que o incidente é de produção (tag, custom field, env)  | Nenhum (considera todos)           |
| `affected_service_field` | De onde extrair o nome/ID do serviço afetado                             | Provider-specific default          |
| `opened_at_field`        | Qual timestamp usar como início do incidente                             | `created_at` / `impactStartDate`   |
| `include_priorities`     | Quais prioridades normalizadas entram no cálculo de MTTR/MTTA            | `["P1", "P2"]`                    |

> A UI deve expor isso como um wizard de "Configurar campos" durante o setup da connection, não como JSON bruto. Os valores disponíveis para `severity_to_priority` devem ser carregados dinamicamente da API do provider (listagem de severities/priorities) e apresentados como dropdowns de mapeamento.

---

### Contrato de Evento

Novo evento publicado quando um incidente é sincronizado:

```json
{
  "event_name": "integration.incident.synced.v1",
  "event_id": "uuid",
  "occurred_at": "2026-04-14T11:00:00Z",
  "source": "opsgenie",
  "payload": {
    "incident_event_id": "uuid",
    "external_id": "70413a06-...",
    "tenant_id": "tenant-uuid",
    "status": "resolved",
    "priority": "P1",
    "opened_at": "2026-04-14T09:58:00Z",
    "acknowledged_at": "2026-04-14T10:05:00Z",
    "resolved_at": "2026-04-14T11:23:00Z",
    "affected_services": ["payment-api"],
    "tags": ["production", "database"]
  },
  "schema_version": 1
}
```

---

### Impacto no DORA Engine

O `computeMttr` atual recebe `restoreTimesHours: number[]` — a interface não muda.

O que muda é o `service.ts` do módulo DORA, na função que coleta os dados para o MTTR:

**Nova fonte exclusiva: `IncidentEvent`**

Não existe mais fallback para bug tasks JIRA. Se o tenant não tiver uma integração de incident management configurada e ativa, o MTTR retorna `null` com `mttr_source: "not_configured"`. Isso é preferível a retornar um número baseado em heurística ruim.

```typescript
// dora/service.ts — pseudocódigo da nova lógica
async function getMttrSamples(tenantId, since) {
  const hasIncidentIntegration = await hasActiveIncidentConnection(tenantId);

  if (!hasIncidentIntegration) {
    return { samples: [], source: 'not_configured' };
  }

  const incidents = await prisma.incidentEvent.findMany({
    where: {
      tenantId,
      resolvedAt: { not: null },
      openedAt: { gte: since },
      priority: { in: ['P1', 'P2'] }  // conforme field_mapping.include_priorities
    }
  });

  return {
    samples: incidents.map(i => hoursBetween(i.openedAt, i.resolvedAt)),
    source: 'incidents'
  };
}
```

**Resposta da API quando não configurado:**
```json
{
  "mttr": null,
  "mttr_source": "not_configured",
  "mttr_message": "Configure uma integração OpsGenie ou incident.io para calcular o MTTR."
}
```

---

### Autenticação e Secrets

Ambos os connectors usam `db_encrypted` como estratégia de secret (padrão atual).

**OpsGenie credentials shape:**
```json
{
  "auth_type": "api_key",
  "api_key": "<GenieKey>",
  "region": "us"  // ou "eu" para instância europeia
}
```

**incident.io credentials shape:**
```json
{
  "auth_type": "bearer",
  "api_key": "<bearer_token>"
}
```

**OpsGenie scope:**
```json
{
  "use_incident_api": true,     // false = fallback para Alert API (plano Essentials)
  "region": "us",              // "us" ou "eu"
  "field_mapping": {
    "severity_to_priority": { "P1": "P1", "P2": "P2", "P3": "P3", "P4": "P4", "P5": "P5" },
    "production_indicator": { "type": "tag", "values": ["production"] },
    "affected_service_field": { "type": "impacted_services" },
    "opened_at_field": "impactStartDate",
    "include_priorities": ["P1", "P2"]
  }
}
```

**incident.io scope:**
```json
{
  "field_mapping": {
    "severity_to_priority": {
      "Critical": "P1",
      "Major": "P2",
      "Minor": "P3",
      "Warning": "P4"
    },
    "production_indicator": { "type": "tag", "values": ["production"] },
    "affected_service_field": { "type": "custom_field", "field_id": "" },
    "opened_at_field": "created_at",
    "include_priorities": ["P1", "P2"]
  }
}
```

> Os valores de `severity_to_priority` devem ser carregados dinamicamente da API do provider durante o setup para popular o wizard de configuração. O `field_id` de `affected_service_field` é obtido do endpoint de custom fields do incident.io.

---

### Webhook Support

Ambos os providers suportam webhooks. O receiver existente (`webhook-routes.ts`) já tem a estrutura para adicionar novos providers.

**Eventos relevantes para capturar:**

| Provider     | Evento webhook                   | Ação no sistema                            |
|--------------|----------------------------------|--------------------------------------------|
| OpsGenie     | `Create` (alert/incident)        | Criar IncidentEvent com `status=open`      |
| OpsGenie     | `Acknowledge`                    | Atualizar `acknowledged_at`                |
| OpsGenie     | `Close` / Resolve                | Atualizar `resolvedAt`, calcular MTTR      |
| incident.io  | `incident.created`               | Criar IncidentEvent                        |
| incident.io  | `incident.status_updated`        | Atualizar status e timestamps              |
| incident.io  | `incident.resolved`              | Atualizar `resolvedAt`                     |

---

## Impacto na API DORA (endpoints existentes)

A API de DORA (`GET /api/v1/dora/:projectId`) passa a:

1. Retornar MTTR exclusivamente de `IncidentEvent` — sem fallback para bug tasks
2. Indicar o estado da fonte: `"mttr_source": "incidents" | "not_configured"`
3. Retornar o número de amostras: `"mttr_sample_count": 12`
4. Expor novas métricas quando IncidentEvents disponíveis:
   - `mtta`: `{ value: number, unit: "hours", level: DoraLevel }` — health metric, não DORA oficial
   - `incident_frequency`: `{ value: number, unit: "per_day" }` — health metric complementar

A mudança no MTTR é **breaking** para tenants que usavam a heurística de bug tasks — eles passarão a receber `null` até configurar uma integração. Isso deve ser comunicado proativamente. Os campos novos (`mtta`, `incident_frequency`) são adicionais e backward compatible.

---

## Plano de Migrations Prisma

### Migration 1: `add_incident_providers`
- Adiciona `opsgenie` e `incident_io` ao enum `IntegrationProvider`

### Migration 2: `add_incident_event`
- Cria tabela `IncidentEvent` com índices:
  - `(tenantId, provider, externalId)` — unique (upsert)
  - `(tenantId, openedAt)` — para queries de MTTR por janela temporal
  - `(tenantId, priority, resolvedAt)` — para queries de P1/P2 resolvidos

---

## Scope de Testes

### Unit tests obrigatórios
- [ ] `FieldMappingResolver`: aplicar field mapping ao transformar severity → priority (todos os providers)
- [ ] `IncidentIoTransformer`: `IncidentIoIncident + FieldMapping → IncidentEvent` (severity mapping customizado)
- [ ] `OpsGenieTransformer`: `OpsGenieIncident + FieldMapping → IncidentEvent` (P1 open, P2 resolved, P5 fora do include_priorities)
- [ ] `dora/service.ts`: MTTR retorna `null` quando não há connection ativa de incident management
- [ ] `dora/service.ts`: MTTR calculado corretamente com `IncidentEvent[]`
- [ ] `dora/engine.ts`: `computeMttr` com array de incidents (sem mudança de interface)

### Integration tests obrigatórios
- [ ] Sync incremental incident.io: paginação + idempotência + field mapping aplicado
- [ ] Sync incremental OpsGenie: paginação + idempotência + field mapping aplicado
- [ ] Webhook incident.io: `incident.resolved` atualiza `resolvedAt`
- [ ] Webhook OpsGenie: `Acknowledge` atualiza `acknowledged_at`, `Close` atualiza `resolvedAt`
- [ ] DORA scorecard: MTTR = null quando sem integração, MTTR calculado quando com integração
- [ ] Incidente reaberto: `resolvedAt` é limpo corretamente

---

## Riscos e Mitigações

| Risco                                                            | Probabilidade | Mitigação                                                             |
|------------------------------------------------------------------|---------------|-----------------------------------------------------------------------|
| Tenant sem integração → MTTR vira null (breaking change)         | Alta          | Comunicar proativamente; exibir CTA de setup na UI do DORA scorecard  |
| Field mapping mal configurado → prioridades erradas              | Alta          | Wizard de "Configurar campos" obrigatório no setup; preview do mapping |
| Cliente usa plano Essentials do OpsGenie (sem Incident API)      | Alta          | Fallback transparente para Alert API com filter de prioridade         |
| Severity names mudando no provider sem atualizar o mapping       | Média         | Alertar quando `IncidentEvent` receber severity não mapeada           |
| Incidente reaberto após resolução (reopen)                       | Baixa         | Tratamento de estado `reopened` — limpar `resolvedAt`                 |
| Incident.io sem `resolved_at` para incidentes antigos           | Baixa         | Usar `updated_at` do status "resolved" via status history             |
| Webhook delivery failure                                         | Média         | Pull incremental como fonte verdadeira; webhook é otimização          |
| Gap entre resolução técnica e encerramento formal do incidente   | Média         | Usar `resolved_at` (não `closed_at`) para MTTR                       |

---

## Roadmap de Execução

> **Prerequisito:** migrations rodando sem downtime em produção (Fly.io)

### Sprint A — Fundação ✅ (concluído 2026-04-14)
- [x] Migração Prisma: `20260414130116_add_incident_providers` + `20260414131157_add_incident_event` aplicadas
- [x] `FieldMapping` type + funções `resolveFieldMapping`, `mapSeverityToPriority`, `isProductionIncident`, `extractAffectedServices` em `connectors/field-mapping.ts`
- [x] Contrato de evento `integration.incident.synced.v1` documentado neste MD
- [x] Connectors `incident_io.ts` e `opsgenie.ts` criados com `runSync` completo + registrados em `registry.ts`

### Sprint B — incident.io ✅ (concluído 2026-04-14)
- [x] incident.io Transformer completo com FieldMappingResolver (em `runSync`)
- [x] incident.io pull sync com cursor-based pagination
- [x] Filtro incremental: `updated_at[gte]` (corrigido de `created_at[gte]`)
- [x] Endpoint auxiliar: `GET /integrations/connections/:id/incident-io/severities` (para popular o wizard)
- [x] incident.io webhook handler inline — upsert direto do payload sem esperar re-pull
- [x] Testes unitários: `FieldMappingResolver` — 17 testes passando

### Sprint C — OpsGenie ✅ (concluído 2026-04-14)
- [x] OpsGenie Transformer completo com FieldMappingResolver (Incident API + Alert API fallback) — em `runSync`
- [x] OpsGenie pull sync com paginação offset-based e `sinceDate`
- [x] Suporte a `region: us | eu` e fallback de plano (Alert API)
- [x] Endpoint auxiliar: `GET /integrations/connections/:id/opsgenie/priorities` (retorna P1–P5 fixos)
- [x] OpsGenie webhook handler inline (`Acknowledge`, `Close`, `Reopen`, `Reopen` limpa `resolvedAt`)

### Sprint D — DORA Engine Update ✅ (concluído 2026-04-14)
- [x] Removida lógica de bug tasks do `dora/service.ts`; MTTR agora depende exclusivamente de `IncidentEvent`
- [x] `mttr_source: 'incidents' | 'not_configured'` retornado em todo scorecard
- [x] Overall level calculado apenas com métricas disponíveis (sem penalizar tenants sem integração)
- [x] `mtta` e `incident_frequency` adicionados ao retorno do scorecard
- [x] `computeMtta` e `computeIncidentFrequency` adicionados ao `engine.ts`
- [x] `engine.test.ts` atualizado — 43 testes passando
- [x] OpenAPI spec `dora-v1.yaml` atualizado (scorecard schema, thresholds, history metric list)

### Sprint E — Documentação e Rollout
- [x] Atualizar `docs/dora-metrics.md` (MTTR: nova fonte, MTTA e Incident Frequency documentados)
- [x] Atualizar `docs/frontend/intel-api.md` (anomalias e recommendation types)
- [x] Atualizar `docs/integrations.md` (novos connectors + field mapping)
- [x] Atualizar `docs/frontend/dora-api.md` com novos campos e estado `not_configured`
- [x] Atualizar roadmap (promover item 4.11 de P3 para fase 2.5)

---

## Questões Abertas

- [x] **Qual provider priorizar primeiro?** ~~OpsGenie tem penetração maior no mercado mas incident.io é mais limpo para começar.~~ **Decisão: incident.io primeiro.** API mais simples, sem restrição de plano. OpsGenie é Sprint C.
- [x] **MTTR pode usar JIRA como fallback?** **Decisão: não.** MTTR passa a ser `null` para tenants sem incident integration. Preferível a dado impreciso.
- [x] **MTTA entra no DORA Scorecard oficial?** **Decisão: não** — MTTA não é uma das 4 DORA metrics. Exibir como health metric complementar, ao lado de cycle time e review velocity.
- [x] **Incident frequency substitui CFR ou complementa?** **Decisão: complementa.** CFR mede deploys com defeito; incident_frequency mede volume absoluto de incidentes. Exibir lado a lado no health scorecard.
- [x] **Como mapear `affectedServices` para projetos do moasy?** **Decisão: auto-match por nome.** `affectedServices[]` do `IncidentEvent` é comparado (case-insensitive) contra `name` e `key` dos `Project` ativos do tenant. Se houver match, o MTTR do incidente é atribuído ao projeto correspondente. Se não houver match, o incidente entra no cálculo de **MTTR genérico** (tenant-wide, sem escopo de projeto) — preferível a descartar o dado.
- [ ] **O wizard de "Configurar campos" é bloqueante no setup da connection?** Sugestão: não — permitir salvar a connection sem field mapping e mostrar alerta de "MTTR indisponível até configurar campos". A decidir com produto.
- [ ] **Postmortems do incident.io:** faz sentido sincronizar? Valor potencial: vincular postmortem à task de follow-up no core. Fica como item de backlog futuro.

---

## Referências Técnicas

- [OpsGenie Alert API](https://docs.opsgenie.com/docs/alert-api)
- [OpsGenie Incident API](https://docs.opsgenie.com/docs/incident-api) _(Standard/Enterprise)_
- [OpsGenie Webhooks](https://docs.opsgenie.com/docs/opsgenie-integration-api)
- [incident.io API Reference](https://docs.incident.io/api-reference)
- [DORA Metrics — dora-metrics.md](./dora-metrics.md) — especificação atual do MTTR
- [Integrations Architecture — integrations.md](./integrations.md) — padrão de connector
- [Roadmap — roadmap.md](./roadmap.md) — item 4.11
