# 📋 Sistema de Gestão de Área de Tech - Planejamento Estratégico

> **Foco**: Tech Managers, CTOs e lideranças técnicas com visão operacional e estratégica

## 1. Visão Geral & Objetivos

### Propósito
Centralizar dados fragmentados (JIRA, GitHub) em uma plataforma única que fornece **visibilidade operacional** e **insights estratégicos** para tomada de decisão em tempo real.

### Problemas a Resolver
- 🔴 Dispersão de dados entre múltiplas ferramentas
- 🔴 Falta de correlação entre roadmap, delivery e custos
- 🔴 SLAs indefinidos ou não monitorados
- 🔴 Impossibilidade de rastrear DORA metrics
- 🔴 Blind spot em saúde técnica do time

---

## 2. Arquitetura Modular & Faseado

### Filosofia de Design
- **Isolamento**: Cada módulo é independente e escalável
- **Extensibilidade**: Novas integrações sem refatorar core
- **Observabilidade**: Logs e métricas em cada camada
- **Composição**: Dashboards agregam múltiplos módulos
- **Contract-First**: Troca entre módulos apenas por contratos de API/eventos versionados
- **Data Ownership**: Cada domínio tem dono; nenhum módulo altera dados de outro diretamente

```
┌─────────────────────────────────────────────────────────────┐
│                    API Gateway / Core                        │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ Integrações  │  │  Entidades   │  │ Computações  │       │
│  │  (JIRA/GH)   │  │  (Domain)    │  │ (Engines)    │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ Dashboards   │  │ Alertas      │  │ Analytics    │       │
│  │              │  │              │  │              │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
└─────────────────────────────────────────────────────────────┘
       ↓ Storage / Cache (DB + Redis)
```

### 2.1 Contratos Entre Módulos (Regra de Independência)

Princípio central: modulo A nao escreve em tabelas/repositorios internos do modulo B.
Toda interoperabilidade ocorre por interfaces estaveis.

- **Canal permitido 1: API Contracts**
  - REST/GraphQL com schema versionado (`v1`, `v2`)
  - Contrato publicado (OpenAPI/GraphQL schema)
  - Mudancas breaking apenas com deprecacao planejada

- **Canal permitido 2: Event Contracts**
  - Eventos de dominio versionados (`task.updated.v1`, `sla.breached.v1`)
  - Payload com schema imutavel por versao
  - Consumidores desacoplados do storage do produtor

- **Proibicoes arquiteturais**
  - Modulo de analytics atualizar tabela transacional do modulo de entidades
  - Modulo de dashboard fazer query direta em banco de integracoes
  - Reuso de tabela compartilhada entre modulos sem owner definido

- **Padrão de ownership sugerido**
  - Integracoes: dados brutos externos + estado de sync
  - Entidades/Core: modelo canonico de dominio
  - SLAs: regras, instancias e compliance
  - Metrics/Analytics: agregacoes e series historicas
  - COGS: custos e consolidacoes financeiras

- **Governanca de contrato**
  - Contract tests no CI para validar produtores e consumidores
  - Compatibility check automatica para versoes de schema
  - Changelog de contratos por modulo

---

## 3. Fases de Implementação

### ⭐ Fase 1: MVP Core (Semanas 1-4)
**Objetivo**: Ingesstar dados + Visualizar baseline

- [ ] **Módulo Integrações**
  - Connector JIRA (sprints, épicos, tasks, status)
  - Connector GitHub (issues, PRs, commits, branches)
  - Sync automático (configurável em frequência)
  - Deduplicação de dados
  - Publicação de eventos versionados para Core (sem acesso direto ao banco de outros módulos)

- [ ] **Entidades Base**
  - Projeto (agrupador principal)
  - Tarefa (issue única, traceável)
  - Épico (agrupador temático)
  - Usuário (do JIRA + GitHub, com unificação)
  - Status workflow
  - API pública do Core para consumo por outros módulos

- [ ] **Dashboard MVP**
  - Overview por projeto (todo, in progress, blocked, done)
  - Sprint burndown (se JIRA ativo)
  - PRs em aberto
  - Tempo médio de resolução
  - Consumo apenas via API/BFF (sem query direta em storage interno de outros módulos)

---

### ⭐ Fase 2: Métricas & SLAs (Semanas 5-8)
**Objetivo**: Estabelecer baselinas e KPIs

- [ ] **DORA Metrics Engine**
  - Deployment Frequency (via GitHub tags/releases)
  - Lead Time for Changes (PR criação → merge)
  - Mean Time to Restore (hotfix detection)
  - Change Failure Rate (correlação commit → bug reports)

- [ ] **SLA Module**
  - Template de SLAs por tipo de tarefa (bug, feature, escalação)
  - Histórico de SLA (met/missed)
  - Alertas de SLA violation
  - Relatórios de compliance

- [ ] **Health Metrics**
  - Code review velocity
  - PR rejection rate
  - Cycle time (criação → fechamento)
  - Tech debt ratio (tags no JIRA)

- [ ] **Dashboard Executivo**
  - DORA scorecard
  - SLA compliance
  - Team health score (composição)

---

### ⭐ Fase 3: COGS & Custos (Semanas 9-12)
**Objetivo**: Visão de eficiência financeira

- [ ] **COGS Module**
  - Custo por task (~salary/horas + overhead)
  - Custo por epic (rollup)
  - Custo por projeto
  - Custo de SLA violation

- [ ] **Effort Estimation**
  - Story points → horas reais (via timetracking ou JIRA custom field)
  - Desvios (planned vs actual)
  - Team velocity trend

- [ ] **Analytics**
  - Custo por feature releases
  - ROI de épicos (correlação com roadmap)
  - Burn rate de projeto

- [ ] **Dashboard CFO/Product**
  - Investimento por roadmap item
  - Cost per deployment
  - Team utilization

---

### ⭐ Fase 4: Inteligência & Previsão (Semanas 13-16)
**Objetivo**: Insights preditivos

- [ ] **Predictive Analytics**
  - Forecast de sprint velocity
  - Risco de SLA violation
  - Estimativa de término (de épicos/projetos)

- [ ] **Agregações Avançadas**
  - Timeline multidimensional (time, projeto, team, status)
  - Correlação de métricas
  - Causa-raiz de degradação DORA

- [ ] **Alertas Proativos**
  - Trend analysis (if velocity ↓, then alert)
  - Anomaly detection
  - Recomendações (reacrocar time, refocus, etc)

---

## 4. Entidades do Sistema (Domain Model)

### 4.1 Usuário
```
User
├── id (UUID)
├── email (unique)
├── name
├── avatar_url
├── integrações
│   ├── jira_user_id
│   ├── github_handle
│   └── ...
├── team_membership
│   ├── team_id (FK)
│   └── role (lead, ic, contractor)
├── metadata
│   ├── start_date
│   ├── cost_per_hour
│   └── tags (frontend, backend, devops...)
└── is_active
```

### 4.2 Projeto
```
Project
├── id (UUID)
├── key (JIRA project key ou GitHub org)
├── name
├── repository_ids (FK → Repository)
├── team_id (FK → Team, opcional)
├── status (active, archived, planning)
├── dates
│   ├── created_at
│   ├── start_date
│   └── target_end_date
├── settings
│   ├── sla_template_id (FK)
│   ├── sync_frequency
│   └── custom_fields
└── metadata
    └── tags (frontend, backend, infra...)
```

### 4.3 Tarefa / Task
```
Task
├── id (UUID)
├── source (JIRA | GitHub)
├── source_id (issue key/number)
├── titulo
├── descrição
├── project_id (FK)
├── epic_id (FK, opcional)
├── assignee_id (FK → User)
├── status (backlog, todo, in_progress, review, done)
├── priority (1-5 ou P0-P4)
├── task_type (bug | feature | spike | chore | tech_debt)
├── dates
│   ├── created_date
│   ├── start_date
│   ├── due_date
│   └── completed_date
├── effort
│   ├── story_points (planejado)
│   ├── hours_estimated
│   ├── hours_actual
│   └── confidence
├── sla
│   ├── sla_id (FK)
│   ├── target_time (minutos)
│   ├── actual_time
│   └── status (met | at_risk | breached)
├── correlations
│   ├── related_prs (GitHub)
│   ├── related_commits
│   └── linked_tasks
└── tags
```

### 4.4 Épico
```
Epic
├── id (UUID)
├── projeto_id (FK)
├── name
├── description
├── goal (OKR alignment, opcional)
├── status (backlog | active | completed)
├── dates
│   ├── start_date
│   ├── target_end_date
│   └── actual_end_date
├── aggregates
│   ├── total_tasks
│   ├── total_story_points
│   ├── actual_hours
│   ├── actual_cost
│   └── health_score
├── team_member_ids (FKs)
└── tags
```

### 4.5 SLA
```
SLA
├── id (UUID)
├── name
├── descrição
├── task_type (applicable to which types)
├── priority_levels
│   ├── P0: 2h
│   ├── P1: 8h
│   ├── P2: 24h
│   ├── P3: 72h
│   └── P4: 1w
├── escalation_rule
├── created_at
└── is_active
```

### 4.6 Health Metric
```
HealthMetric
├── id (UUID)
├── type (DORA | SLA | CODE_QUALITY | TEAM_VELOCITY)
├── metric_name (deployment_frequency, lead_time, etc)
├── project_id (FK, opcional - can be system-wide)
├── time_window (1h | 1d | 1w | 1m | 1q)
├── value (número)
├── baseline (valor esperado)
├── status (healthy | warning | critical)
├── recorded_at
├── context
│   └── tags, dimensions
└── calculation_metadata
```

### 4.7 COGS Entry
```
COGSEntry
├── id (UUID)
├── date (período)
├── user_id (FK)
├── project_id (FK, opcional)
├── task_id (FK, opcional)
├── epic_id (FK, opcional)
├── hours_worked
├── hourly_rate
├── total_cost
├── category (salary | overhead | tooling | cloud)
├── status (approved | pending)
└── notes
```

### 4.8 Team (Agregador)
```
Team
├── id (UUID)
├── name
├── description
├── member_ids (FKs → User)
├── lead_id (FK → User)
├── owned_projects (FKs)
└── metadata
    ├── budget_quarterly
    └── tags (backend, platform, product...)
```

---

## 5. Módulo de Integrações (Arquitetura)

### 5.1 Padrão de Connector
```
BaseConnector (interface)
├── authenticate()
├── fetch_data(resource_type, filter)
├── transform_to_domain(external_dto)
├── sync_state(last_sync_timestamp)
└── health_check()

JiraConnector(BaseConnector)
├── fetch_sprints()
├── fetch_issues()
├── fetch_epics()
└── stream_changelog()

GitHubConnector(BaseConnector)
├── fetch_repos()
├── fetch_issues()
├── fetch_prs()
├── fetch_commits()
└── stream_webhooks()
```

### 5.2 Sincronização
- **Pull Model**: Scheduler a cada 15min / 1h
- **Push Model**: Webhooks (JIRA, GitHub) para eventos imediatos
- **Retry Logic**: Exponential backoff + DLQ
- **Deduplicação**: UUID baseado em source_id + source
- **Conflict Resolution**: Last-write-wins ou merge inteligente

### 5.3 Armazenamento Intermediário
```
integration_cache (Redis/In-Memory)
├── last_sync_timestamp por connector
├── failed_syncs (retry queue)
├── webhook_queue
└── rate_limit_counters
```

---

## 6. Sugestões Adicionais de Escopo

### 🎯 **Gestão de Roadmap & Visibilidade**
- [ ] Timeline visual (Gantt ou Kanban hierárquico)
- [ ] Roadmap vs Actual (replanning detection)
- [ ] Dependency graph (tarefa A bloqueia B)
- [ ] Burndown por roadmap item (não só sprint)

### 🎯 **Gestão de Tech Debt**
- [ ] Backlog explícito de tech debt (tag especial)
- [ ] Ratio de tech debt vs feature work
- [ ] Custo de não fazer tech debt (debt compounding)
- [ ] Alertas de "debt overload" (>30% backlog)

### 🎯 **Quality & Security**
- [ ] Integração com SonarQube / Code Climate (métricas de qualidade)
- [ ] Vulnerabilidade scanning (GitHub/Snyk)
- [ ] Security SLA (tempo até patch crítica)
- [ ] Code review quality metrics

### 🎯 **Planejamento & Capacidade**
- [ ] Capacity planning por team (FTE disponível)
- [ ] Vacation/absence tracking
- [ ] Skill matrix (who can do what)
- [ ] Forecast de sobrecarga (wenn utilization > 90%)

### 🎯 **Integração com OKRs**
- [ ] Épics linkedos a OKRs
- [ ] Progress tracking OKR vs milestone
- [ ] Health score do OKR (% de épicos completados)

### 🎯 **On-Call & Incident Management**
- [ ] Pagerduty / Opsgenie integration
- [ ] MTTR (Mean Time to Response)
- [ ] Incident correlation (task → incident)
- [ ] On-call rotation tracking

### 🎯 **Notifications & Insights**
- [ ] Slack/Teams integration (daily/weekly digests)
- [ ] Personalized recommendations (por role)
- [ ] Anomaly alerts (velocity drop 30% WoW)
- [ ] Escalation workflows

### 🎯 **Custom Dashboards & Reports**
- [ ] Drag-drop dashboard builder
- [ ] Scheduled reports (PDF/email)
- [ ] Export (CSV, Parquet für BI tools)
- [ ] White-label opção

### 🎯 **Feedback & Retrospectivas**
- [ ] Post-mortem templates
- [ ] Lessons learned capture
- [ ] Action items tracking
- [ ] Velocity reflection

### 🎯 **Auditoria & Compliance**
- [ ] Change log (who changed what, when)
- [ ] SLA breach details audit trail
- [ ] Cost allocation (chargeback para clientes internos)
- [ ] Data retention policies

---

## 7. Tecnologia Stack (Sugestão)

### Backend
- **API**: Node.js/Fastify ou Python/FastAPI
- **Message Queue**: RabbitMQ / Kafka (para webhooks assíncronos)
- **Cache**: Redis
- **DB**: PostgreSQL (relacional, JSONB para flexibilidade)

### Frontend
- **Framework**: React / Vue (depende preferência)
- **Charts**: Nivo / Apache ECharts
- **State**: TanStack Query + Zustand / Redux

### DevOps
- **Container**: Docker
- **Orchest**: Kubernetes (ou ECS se AWS)
- **Monitoring**: Prometheus + Grafana
- **Logging**: ELK / Splunk

---

## 8. Roadmap Visual

```
Semana    | Fase 1 MVP            | Fase 2 Métricas    | Fase 3 COGS      | Fase 4 Inteligência
1-4       | [#############]       | -                  | -                | -
5-8       | [###]                 | [#############]    | -                | -
9-12      | [###]                 | [###]              | [#############]  | -
13-16     | [###]                 | [###]              | [###]            | [#############]
          | Integrações           | Health + SLAs      | Custos           | Previsão + IA
          | Entities              | Alertas            | Analytics        | Recomendações
          | Dashboard básico       | Executive view     | CFO view         | Insights
```

---

## 9. Critério de Sucesso por Fase

### ✅ Fase 1
- [ ] 100% de dados JIRA sincronizados
- [ ] 100% de dados GitHub sincronizados
- [ ] Dashboard MVP mostrando status atual
- [ ] <5 minutos de latência end-to-end

### ✅ Fase 2
- [ ] 4 DORA metrics rodando com precisão >90%
- [ ] SLAs definidos e monitorados
- [ ] Alertas funcionais (Slack/Teams)
- [ ] Health scorecard atualizado real-time

### ✅ Fase 3
- [ ] COGS por task acurado ±5%
- [ ] ROI de épicos calculável
- [ ] Relatórios CFO automáticos
- [ ] Dashboards de trend de custos

### ✅ Fase 4
- [ ] Forecasts com accuracy >80%
- [ ] Recomendações acionáveis + adotadas
- [ ] ML model estável (drift detection)
- [ ] API aberta para extensões

---

## 10. Considerações Críticas

### Segurança & Privacidade
- 🔒 OAuth2 / SAML para auth
- 🔒 Encriptação de credentials (Vault)
- 🔒 Row-level security (team isolation)
- 🔒 GDPR compliance (right to delete)

### Performance
- ⚡ Indexação agressiva (timestamps, project_id, status)
- ⚡ Materialized views para agregações pesadas
- ⚡ Cache multi-layer (Redis → In-memory → CPU)
- ⚡ Async jobs para reports longos

### Escalabilidade
- 📈 Event sourcing para auditoria completa
- 📈 Sharding por project_id se >10M tasks
- 📈 Read replicas para relatórios
- 📈 API versioning (v1, v2, ...)

### Data Governance
- 📊 Data lineage (source → transform → metric)
- 📊 Metadata catalog (descrição de campos)
- 📊 Data quality rules (alertas de inconsistências)
- 📊 Backup + recovery plan

---

## 11. Próximos Passos

1. **Validação com Stakeholders**
   - [ ] Revisar com CTO/Tech Lead
   - [ ] Ajustar prioridades conforme pain points reais
   - [ ] Confirmar budget & timeline

2. **Design Detalhado (Fase 1)**
   - [ ] ERD completo
   - [ ] API specification (OpenAPI)
   - [ ] Mockups de UI

3. **Setup Técnico**
   - [ ] Repository + CI/CD
   - [ ] Local dev environment
   - [ ] Primeiro connector (JIRA)

4. **Prototipagem Rápida**
   - [ ] Validar fluxo end-to-end JIRA → Dashboard
   - [ ] Feedback loop rápido
   - [ ] Ajustar baseando em real feedback

---

## 12. Backend-First: Contratos e Payloads por Modulo

### 12.1 Padrao de Contrato (comum a todos os modulos)

Todos os contratos backend devem seguir padrao estavel e versionado.

- API versionada: `/api/v1/...`
- Eventos versionados: `modulo.entidade.acao.v1`
- Correlation ID obrigatorio para rastreabilidade
- Idempotency key obrigatoria para comandos de escrita assincrona

Envelope padrao de API (response):

```json
{
  "data": {},
  "meta": {
    "request_id": "req_123",
    "version": "v1",
    "timestamp": "2026-04-08T12:00:00Z"
  },
  "error": null
}
```

Envelope padrao de evento:

```json
{
  "event_name": "core.task.created.v1",
  "event_id": "evt_123",
  "correlation_id": "corr_456",
  "occurred_at": "2026-04-08T12:00:00Z",
  "producer": "core",
  "schema_version": 1,
  "payload": {}
}
```

---

### 12.2 Modulo Integracoes

Responsabilidade: ingestao de JIRA/GitHub e publicacao para o Core via contratos.

APIs principais:

- `POST /api/v1/integrations/connections`
  - cria conexao de provider
- `POST /api/v1/integrations/sync-jobs`
  - dispara sync manual
- `GET /api/v1/integrations/sync-jobs/{job_id}`
  - retorna estado de sync

Payload exemplo (criar conexao):

```json
{
  "provider": "jira",
  "tenant_id": "ten_1",
  "credentials": {
    "auth_type": "oauth2",
    "secret_ref": "vault://integrations/jira/tenant_1"
  },
  "scope": {
    "project_keys": ["AUTH", "PLAT"]
  }
}
```

Politica de credenciais para Integracoes:

- Preferencia por `secret_ref` (Vault/KMS externo).
- Quando armazenado no banco: apenas cifrado (AES-256-GCM + envelope encryption com KMS).
- Campos de segredo sempre `writeOnly` em contratos API.
- Rotacao de segredo por endpoint dedicado e auditado.
- Proibido endpoint de leitura de segredo em texto plano.

Evento publicado para Core:

```json
{
  "event_name": "integration.task.synced.v1",
  "payload": {
    "source": "jira",
    "source_id": "AUTH-123",
    "project_key": "AUTH",
    "title": "Fix login timeout",
    "status": "in_progress",
    "assignee_email": "dev@empresa.com",
    "updated_at": "2026-04-08T11:58:00Z"
  }
}
```

---

### 12.3 Modulo Core (Entidades Canonicas)

Responsabilidade: ownership das entidades Project, Epic, Task, User, Team.

APIs principais:

- `POST /api/v1/core/tasks`
- `PATCH /api/v1/core/tasks/{task_id}`
- `GET /api/v1/core/tasks/{task_id}`
- `GET /api/v1/core/projects/{project_id}`

Payload exemplo (criar task):

```json
{
  "project_id": "prj_1",
  "epic_id": "epc_10",
  "title": "Implementar endpoint de SLA",
  "task_type": "feature",
  "priority": "P1",
  "assignee_id": "usr_8",
  "source": "manual"
}
```

Eventos publicados:

- `core.task.created.v1`
- `core.task.updated.v1`
- `core.task.status_changed.v1`
- `core.epic.updated.v1`

Payload exemplo (status changed):

```json
{
  "task_id": "tsk_55",
  "previous_status": "in_progress",
  "new_status": "done",
  "changed_by": "usr_8",
  "changed_at": "2026-04-08T15:30:00Z"
}
```

---

### 12.4 Modulo SLA

Responsabilidade: templates, instancias de SLA, compliance e violacoes.

APIs principais:

- `POST /api/v1/slas/templates`
- `POST /api/v1/slas/instances`
- `GET /api/v1/slas/compliance?project_id=...&window=30d`

Payload exemplo (template SLA):

```json
{
  "name": "SLA Bugs Producao",
  "applies_to": ["bug"],
  "rules": {
    "P0": { "target_minutes": 120, "warning_at_percent": 80 },
    "P1": { "target_minutes": 480, "warning_at_percent": 80 }
  },
  "escalation_rule": {
    "at_risk": ["team_lead"],
    "breached": ["team_lead", "manager"]
  }
}
```

Eventos publicados:

- `sla.instance.created.v1`
- `sla.task.at_risk.v1`
- `sla.task.breached.v1`

Payload exemplo (breach):

```json
{
  "task_id": "tsk_55",
  "sla_instance_id": "sla_i_2",
  "target_minutes": 120,
  "actual_minutes": 173,
  "breach_minutes": 53,
  "project_id": "prj_1"
}
```

---

### 12.5 Modulo Metrics (DORA + Health)

Responsabilidade: calculo assincrono e publicacao de snapshots de metricas.

APIs principais:

- `GET /api/v1/metrics/dora/scorecard?project_id=...&window=30d`
- `GET /api/v1/metrics/health?scope=team&scope_id=...&window=7d`
- `POST /api/v1/metrics/recompute-jobs`

Payload exemplo (scorecard response):

```json
{
  "project_id": "prj_1",
  "window": "30d",
  "dora": {
    "deployment_frequency": { "value": 1.4, "unit": "deploys_per_day", "level": "elite" },
    "lead_time": { "value": 18, "unit": "hours_p50", "level": "high" },
    "mttr": { "value": 4.2, "unit": "hours", "level": "high" },
    "change_failure_rate": { "value": 0.08, "unit": "ratio", "level": "high" }
  }
}
```

Eventos publicados:

- `metrics.snapshot.created.v1`
- `metrics.alert.triggered.v1`

---

### 12.6 Modulo COGS

Responsabilidade: custos por task/epic/projeto e consolidacao financeira.

APIs principais:

- `POST /api/v1/cogs/entries`
- `GET /api/v1/cogs/projects/{project_id}/summary?window=30d`
- `GET /api/v1/cogs/epics/{epic_id}/roi`

Payload exemplo (entry COGS):

```json
{
  "period_date": "2026-04-08",
  "user_id": "usr_8",
  "project_id": "prj_1",
  "task_id": "tsk_55",
  "hours_worked": 4.5,
  "hourly_rate": 65.0,
  "overhead_rate": 1.25,
  "category": "engineering",
  "source": "timetracking"
}
```

Eventos publicados:

- `cogs.entry.created.v1`
- `cogs.project.summary.updated.v1`
- `cogs.epic.roi.updated.v1`

---

### 12.7 Modulo Dashboards/BFF

Responsabilidade: composicao de dados para front-end, sem ownership de dominio.

APIs principais:

- `GET /api/v1/dashboard/executive?org_id=...&window=30d`
- `GET /api/v1/dashboard/manager?team_id=...&window=7d`

Regra: somente leitura via APIs dos modulos Core, SLA, Metrics e COGS.
Nao pode persistir ou alterar dados de dominio.

---

## 13. Permissoes e Roles (RBAC + Escopo)

Principio: toda requisicao e avaliada no contexto de tenant. Nao existe acesso cross-tenant.

### 13.1 Roles sugeridas

- `org_admin`: governanca global, configuracao de modulos, acesso financeiro completo
- `cto_exec`: visao executiva e financeira agregada
- `tech_manager`: operacao de squads, SLA e planejamento
- `staff_engineer`: leitura operacional ampla, sem dados financeiros sensiveis individuais
- `engineer`: leitura/escrita restrita ao proprio escopo de trabalho
- `finance_analyst`: leitura COGS e relatórios financeiros
- `viewer`: somente leitura de dashboards permitidos

### 13.1.1 Isolamento por Tenant (cliente)

- Cada cliente e um `tenant_id` isolado logicamente.
- Todo dado de dominio deve carregar `tenant_id` (ou `org_id` equivalente).
- Toda consulta backend aplica filtro obrigatorio por tenant antes de qualquer outra regra.
- Tokens de acesso devem conter `tenant_id` ativo; requisicao sem tenant valido retorna `403`.
- Integracoes externas sao configuradas por tenant (nunca compartilhadas entre clientes).

### 13.2 Matriz de permissao por modulo (baseline de roles de sistema)

> **Esta matriz define apenas os acessos padrão por role de sistema.** Ela não é o mecanismo de enforcement — é a configuração base dos **Permission Profiles pré-definidos** que o sistema cria por tenant. Admins podem criar quantos perfis customizados quiserem e associar a usuarios (ver 13.3.1).

| Modulo | org_admin | cto_exec | tech_manager | staff_engineer | engineer | finance_analyst | viewer |
|---|---|---|---|---|---|---|---|
| Integracoes (configurar conexoes) | RW | R | R (time scope) | R | - | - | - |
| Core (tasks/epics/projects) | RW | R | RW (time scope) | RW (project scope) | RW (own scope) | R | R |
| SLA (templates/instancias) | RW | R | RW | R | R (own tasks) | R | R |
| Metrics (DORA/health) | RW | R | R | R | R (team scope) | R | R |
| COGS agregado | RW | R | R | R (sem custos individuais) | - | R | - |
| COGS detalhado (hourly_rate por pessoa) | RW | R | R restrito | - | - | R | - |

Legenda: `RW` leitura e escrita, `R` somente leitura, `-` sem acesso.

### 13.3 Regras de autorizacao obrigatorias

- Policy enforcement na API Gateway e no modulo dono do recurso.
- Escopo por tenant/org e por team (`team_id`) em todas as queries.
- Row-Level Security para dados sensiveis (principalmente COGS).
- Auditoria de acesso para endpoints financeiros e administrativos.
- Tokens JWT com claims: `sub`, `tenant_id`, `org_id`, `team_ids`, `roles`, `permission_profile_ids`, `permissions_version`.

Payload exemplo (claims JWT):

```json
{
  "sub": "usr_8",
  "tenant_id": "ten_1",
  "org_id": "org_1",
  "team_ids": ["team_a", "team_b"],
  "roles": ["tech_manager"],
  "permission_profile_ids": ["pp_manager_default"],
  "permissions_version": 3
}
```

### 13.3.1 Perfis de Permissao (Permission Profiles) — mecanismo central

Perfis sao a unidade real de controle de acesso no sistema. Um perfil e um grupo nomeado de permissoes atomicas, criado e gerenciado por tenant. Roles de sistema (tabela 13.2) sao apenas perfis pre-definidos — qualquer admin pode criar perfis customizados com a granularidade que quiser.

**Entidade `Permission`** — catalogo de permissoes atomicas por modulo:

| Permissao                         | Descricao                               |
|-----------------------------------|-----------------------------------------|
| `core.task.read`                  | Ler tasks                               |
| `core.task.write`                 | Criar/editar tasks                      |
| `core.task.write.team`            | Criar/editar tasks do proprio time      |
| `core.epic.manage`                | Gerenciar epics                         |
| `sla.template.read`               | Ver templates de SLA                    |
| `sla.template.manage`             | Criar/editar templates de SLA           |
| `sla.instance.read`               | Ver instancias de SLA                   |
| `metrics.read`                    | Ler metricas (todos os times)           |
| `metrics.read.team`               | Ler metricas (proprio time)             |
| `cogs.read.aggregated`            | Ver COGS agregado (sem detalhe pessoal) |
| `cogs.read.detailed`              | Ver COGS detalhado por hora/pessoa      |
| `integrations.connection.read`    | Ver conexoes de integracao              |
| `integrations.connection.manage`  | Criar/editar conexoes                   |
| `integrations.secret.rotate`      | Rotacionar segredos de integracao       |
| `iam.profile.manage`              | Criar/editar perfis de permissao        |
| `iam.profile.assign`              | Associar perfis a usuarios              |

**Entidade `PermissionProfile`:**

```json
{
  "id":          "pp_frontend_lead",
  "tenant_id":   "ten_1",
  "name":        "Lead Frontend",
  "description": "Acesso operacional para lideres de frontend",
  "permissions": [
    "core.task.write.team",
    "core.epic.manage",
    "sla.template.read",
    "sla.instance.read",
    "metrics.read.team",
    "cogs.read.aggregated"
  ],
  "is_system":   false,
  "is_active":   true
}
```

**Entidade `UserPermissionProfile`** — associacao N:N com suporte a concessao temporaria:

| Campo                  | Tipo       | Descricao                                            |
|------------------------|------------|------------------------------------------------------|
| `user_id`              | UUID       | FK → User                                            |
| `tenant_id`            | UUID       | FK → Tenant                                          |
| `permission_profile_id`| UUID       | FK → PermissionProfile                               |
| `granted_by`           | UUID       | Quem concedeu                                        |
| `granted_at`           | timestamp  |                                                      |
| `expires_at`           | timestamp? | Concessao temporaria (null = permanente)              |
| `revoked_at`           | timestamp? | Preenchida em revogacao explicita                    |

**Resolucao de permissoes efetivas** — um usuario pode ter N perfis ativos; as permissoes sao a uniao de todos:

```
permissoes_efetivas = union(
  roles_de_sistema[user.roles],
  active_permission_profiles[user.permission_profile_ids]
)
```

Um perfil vencido (`expires_at < now`) ou revogado nao e incluido na resolucao e nao aparece no JWT.

APIs de administracao de perfis:

- `POST /api/v1/iam/permission-profiles` — criar perfil customizado
- `PATCH /api/v1/iam/permission-profiles/{profile_id}` — editar perfil
- `GET /api/v1/iam/permission-profiles` — listar perfis do tenant
- `POST /api/v1/iam/users/{user_id}/permission-profiles` — associar perfil a usuario
- `DELETE /api/v1/iam/users/{user_id}/permission-profiles/{profile_id}` — revogar
- Contrato completo: `docs/openapi/iam-v1.yaml`

### 13.3.2 Bloqueio Obrigatorio no Backend

Nao confiar apenas no front-end. Toda rota protegida deve validar tenant + permissao no backend.

Fluxo minimo por request:

1. Validar token e extrair `tenant_id`, `sub`, `roles`, `permission_profile_ids`.
2. Resolver permissoes efetivas (roles + perfis ativos no tenant).
3. Aplicar policy por recurso/acao (RBAC + ABAC).
4. Aplicar filtro de tenant/team na query.
5. Se negar, responder `403 FORBIDDEN` com `required_permission`.

Contrato OpenAPI transversal de autorizacao:

- `docs/openapi/authorization-policy-v1.yaml`
  - define avaliacao de policy (`/authorization/policies/evaluate`)
  - define bindings de rota para permissoes (`/authorization/routes/bindings`)
  - padroniza erro `403` e motivo da negacao (`tenant_mismatch`, `missing_permission`, etc.)

Exemplo de policy binding (conceitual):

```yaml
route: PATCH /api/v1/core/tasks/{task_id}
required_permissions:
  - core.task.write
  - core.task.write.team
abac:
  - task.tenant_id == ctx.tenant_id
  - task.team_id in ctx.team_ids
```

Eventos de auditoria recomendados:

- `iam.access.granted.v1`
- `iam.access.denied.v1`
- `iam.permission_profile.assigned.v1`
- `iam.permission_profile.revoked.v1`
- `integrations.secret.rotated.v1`
- `integrations.secret.access.denied.v1`

### 13.4 Modelo de Policy (ABAC complementar)

Além de RBAC, usar atributos para casos finos:

- owner check: engenheiro pode editar task se `task.assignee_id == sub`
- team boundary: manager acessa apenas projetos do proprio `team_id`
- finance guard: somente roles aprovadas leem `hourly_rate`

### 13.5 Contratos de erro de autorizacao

Resposta padrao para proibicao de acesso:

```json
{
  "data": null,
  "meta": {
    "request_id": "req_789",
    "version": "v1",
    "timestamp": "2026-04-08T12:10:00Z"
  },
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission for this resource",
    "details": {
      "required_permission": "cogs.read.detailed"
    }
  }
}
```

---

**Documento vivo** - Atualizar conforme descobertas e feedback 📝
