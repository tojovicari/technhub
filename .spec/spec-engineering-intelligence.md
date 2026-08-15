# 📄 Especificação Técnica: Plataforma de Engineering Intelligence

- **Status:** Em Construção / Especificação Concluída
- **Versão:** 0.4.0
- **Data:** 22 de Julho de 2026
- **Objetivo:** Plataforma modular de métricas de engenharia (DORA, Flow Metrics, SPACE e Operacionais) com ingestão assíncrona batch, arquitetura plugável, mapeamento semântico dinâmico por time e gestão unificada de identidades.

**Este arquivo é o índice.** Só as Seções 1 e 2 (visão geral, sem elas nada do resto faz sentido) ficam aqui — o resto foi quebrado por tópico em arquivos próprios neste mesmo diretório (`.spec/`), pra não carregar 500+ linhas só pra consultar uma seção. Referências a "Seção N" em qualquer lugar do código/docs continuam valendo — usa a tabela abaixo pra achar o arquivo.

---

## 1. Visão Geral da Arquitetura de Dados

O sistema adota o padrão ELT (Extract, Load, Transform) estruturado em 4 camadas de dados isoladas. Essa separação garante auditabilidade, suporte a reprocessamento histórico e desacoplamento total entre as APIs externas e as regras de negócio do dashboard.

+-------------------+ +-------------------+ +-------------------+ +-------------------+
| 1. Raw Layer | --> | 2. Canonical L. | --> | 3. Enriched L. | --> | 4. Analytics L. |
| (JSON Bruto) | | (Dados Nativos) | | (Semântica) | | (Aggregates) |
+-------------------+ +-------------------+ +-------------------+ +-------------------+
Payloads de API Modelos Comuns Aplica Regras de Dashboards DORA,
sem alterações (Língua Franca) Domínio/Mapeamentos Flow, SPACE e Ops

### Princípios Norteadores de Design:

1. Assincronismo & Batch First: Ingestão agendada via cron/workers (ex: execuções a cada 1h, 6h ou diárias). Elimina a complexidade de processamento em tempo real, já que a ferramenta é voltada para gestão e inteligência.
2. Pluggable Architecture (Provedores Extensíveis): O core da aplicação interage exclusivamente com a Camada Canônica. Novas ferramentas (GitLab, Bitbucket, Opsgenie, etc.) são adicionadas como novos conectores isolados herdando da classe BaseProvider.
3. Mapeamento Semântico Desconectado & Flexibilidade Total: Nenhuma métrica, gatilho de deploy ou tipo de card possui regra hardcoded. O significado do dado é definido por regras configuráveis por time.
4. Privacidade por Design: Dados sensíveis de comunicação (Slack/Teams) são ingeridos exclusivamente como metadados agregados, sem armazenamento de corpo de mensagens.
5. Isolamento Multi-Tenant por Padrão: Toda tabela que armazena dado de negócio (Camadas Canônica, Enriquecida e de Identidade) carrega `tenant_id` e é protegida por Row-Level Security (RLS) no PostgreSQL — ver Seção 4.3 ([identity-and-teams.md](./identity-and-teams.md)). O filtro por `tenant_id` na camada de aplicação continua existindo, mas nunca é a única barreira contra vazamento de dado entre tenants (empresas clientes).

---

## 2. Ecossistema de Origens e Matriz de Cobertura

O sistema integra 5 categorias de ferramentas para cobrir os principais frameworks da indústria:

- Issue Trackers: Jira / Linear / Azure Boards
- Version Control: GitHub / GitLab / Azure Repos
- CI / CD: GitHub Actions / ArgoCD / Azure Pipelines
- Incident Mgmt: Waroom / PagerDuty
- Communication: Slack / Microsoft Teams

Azure Boards, Azure Repos e Azure Pipelines cobrem, juntos, as 3 categorias acima como conectores independentes (`azure_boards`, `azure_repos`, `azure_pipelines`) — mesmo padrão do par GitHub/GitHub Actions. Construídos sem credencial real de teste (mesmo regime do ArgoCD): ver `docs/BACKLOG.md` para os pontos ainda não verificados ao vivo.

### Matriz de Mapeamento Metrológico:

| Categoria       | Provedores Suportados (MVP)          | Métricas / Dimensões Atendidas                                                                                            |
| :-------------- | :------------------------------------ | :------------------------------------------------------------------------------------------------------------------------ |
| Issue Tracker   | Jira, Linear, Azure Boards           | Flow Metrics: Velocity, Distribution, Load (WIP), Time.<br>SPACE: Activity.<br>Operacionais: Toil, Retrabalho.            |
| Version Control | GitHub, GitLab, Azure Repos          | DORA: Lead Time for Changes.<br>SPACE: Activity, Communication & Collaboration.<br>Operacionais: Code Churn / Retrabalho. |
| CI / CD         | GitHub Actions, ArgoCD, Azure Pipelines | DORA: Deployment Frequency.                                                                                            |
| Incidents       | Waroom, PagerDuty                    | DORA: Change Failure Rate, MTTR (Failed Service Recovery).                                                                |
| Communication   | Slack, Microsoft Teams               | SPACE: Communication & Collaboration, Efficiency & Flow (Interrupções/Suporte e Atividade Fora do Horário).               |

---

## Índice das demais seções

| Seção | Tópico | Arquivo |
| --- | --- | --- |
| 3 | Mapeamento Semântico (Domain Context Engine) — `mapping_rules`, precedência Time > Org > Sistema | [domain-context-engine.md](./domain-context-engine.md) |
| 4.1–4.3 | Identidades e Times — DDL (`tenants`/`teams`/`users`/`user_provider_aliases`/`team_memberships`), Módulo de Integrações, Row-Level Security | [identity-and-teams.md](./identity-and-teams.md) |
| 4.4–4.4.2 | Alertas In-App, Links de Checkout Enterprise, Retenção de Dados por Plano | [alerts-and-billing-lifecycle.md](./alerts-and-billing-lifecycle.md) |
| 5 | Schemas da Camada Canônica e Enriquecida (`canonical_*`/`enriched_*`) | [canonical-and-enriched-schema.md](./canonical-and-enriched-schema.md) |
| 6–8 | Motor de Métricas Flexíveis (gatilhos por time), Contrato `BaseProvider`, Estrutura do módulo no código | [metrics-and-architecture.md](./metrics-and-architecture.md) |

**Referência complementar, não numerada como seção**: `docs/reprocessing-guide.md` — quando uma mudança de regra semântica/vínculo de time precisa de reprocessamento (`POST .../enrichment/:integrationId/run`) e quando é sempre ao vivo (gatilhos de DORA, capacidade de time, aliases).
