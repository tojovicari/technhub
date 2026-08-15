# Motor de Métricas Flexíveis, Contratos de Provider e Estrutura do Código

Parte de [spec-engineering-intelligence.md](./spec-engineering-intelligence.md) (índice) — Seções 1 e 2 (Visão Geral, Ecossistema de Origens) ficam lá; o resto foi quebrado por tópico neste diretório.

## 6. Motor de Métricas Flexíveis & Gatilhos por Time

Nenhuma métrica possui gatilhos travados. Toda métrica obedece à equação de evento configurável pelo usuário por time:

Valor da Métrica = f(Evento Inicial, Evento Final, Filtro de Categoria, Agrupamento)

### 6.1. Exemplos de Gatilhos Mapeáveis

- Deployment Frequency: Pode ser acionada por Pipeline de CI/CD (GitHub Actions) em um time, ou por transição para a coluna Done do Jira em outro time.
- Lead Time for Changes: Início configurável (1º commit ou abertura de card) e Fim configurável (Deploy CI/CD ou Merge de PR).
- Toil Ratio: Calculado combinando horas em cards marcados como Toil divididas pela Capacidade Total do Time em Horas (default_monthly_capacity_hours).
- Retrabalho (Code Churn / Rework): Medido por % de código reescrito pós-merge ou por devolução de cards de QA para In Dev.

---

## 7. Contratos de Interface (TypeScript BaseProvider Specification)

// src/integrations/core/base.provider.ts
import { SyncContext, SyncResult, ProviderCredentials } from './canonical.types';

export abstract class BaseProvider {
abstract readonly providerName: string;
abstract readonly category: 'issue_tracker' | 'vcs' | 'cicd' | 'incident' | 'communication';

abstract testConnection(credentials: ProviderCredentials): Promise<{ success: boolean; message?: string }>;
abstract syncIncremental(context: SyncContext): Promise<SyncResult>;
}

---

## 8. Estrutura do Módulo no Código (TypeScript/Node.js)

src/
└── integrations/ # Módulo isolado de ingestão
├── core/ # Interfaces, base provider, orquestração
│ ├── base.provider.ts
│ ├── canonical.types.ts
│ └── sync.orchestrator.ts
│
├── providers/ # Submódulo por ferramenta
│ ├── github/
│ ├── jira/
│ ├── linear/
│ ├── incident-io/
│ └── slack/
│
└── jobs/ # Agendadores (Cron / Queue workers)
└── fetch-daily-metrics.job.ts
