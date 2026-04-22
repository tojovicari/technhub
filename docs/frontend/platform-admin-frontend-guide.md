# Platform Admin — Guia de Integração Frontend

> **Versão:** v1  
> **Audiência:** Engenheiros frontend que constroem o painel de administração da plataforma moasy.tech  
> **Base URL:** `/api/v1`  
> **OpenAPI completo:** [platform-admin-v1.yaml](../openapi/platform-admin-v1.yaml)

---

## 1. Autenticação

Todas as rotas de admin exigem um JWT com `platform_role` não-nulo no payload.

```typescript
// Shape do JWT de admin
interface AdminJWTPayload {
  sub: string; // platform account id
  platform_role: "super_admin" | "platform_admin";
  // Nota: tenant_id pode estar presente mas sem efeito em rotas /platform/*
}
```

### Como detectar se o usuário logado é admin

```typescript
import { jwtDecode } from "jwt-decode"; // ou sua lib de JWT

const decoded = jwtDecode<AdminJWTPayload>(accessToken);

const isSuperAdmin = decoded.platform_role === "super_admin";
const isPlatformAdmin = decoded.platform_role === "platform_admin";
const isAnyAdmin = isSuperAdmin || isPlatformAdmin;
```

### Diferenças entre super_admin e platform_admin

| Capacidade                                | super_admin | platform_admin |
| ----------------------------------------- | :---------: | :------------: |
| Listar tenants                            |     ✅      |       ✅       |
| Ver detalhe de tenant                     |     ✅      |       ✅       |
| Ver métricas de receita                   |     ✅      |       ✅       |
| Ver histórico de subscription             |     ✅      |       ✅       |
| Ver audit de impersonação                 |     ✅      |       ✅       |
| Gerenciar planos (criar/editar)           |     ✅      |       ✅       |
| **Force-assign subscription (PUT)**       |     ✅      |     ❌ 403     |
| **Ações manuais em subscription (PATCH)** |     ✅      |     ❌ 403     |
| **Impersonar tenant (POST)**              |     ✅      |     ❌ 403     |

> Esconda os botões de ações destrutivas/write para `platform_admin` — mas sempre trate o 403 no cliente como fallback.

---

## 2. Tratamento padrão de erros

Todos os endpoints seguem o mesmo envelope de erro:

```typescript
interface ErrorEnvelope {
  data: null;
  meta: { request_id: string; version: string; timestamp: string };
  error: {
    code: string; // ex: 'NOT_FOUND', 'FORBIDDEN', 'CONFLICT'
    message: string;
    details?: unknown;
  };
}
```

### Tratamento centralizado (interceptor)

```typescript
// Exemplo com fetch wrapper
async function adminFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1${url}`, {
    headers: {
      Authorization: `Bearer ${getAdminToken()}`,
      ...options?.headers,
    },
    ...options,
  });

  const body = await res.json();

  if (!res.ok) {
    switch (res.status) {
      case 401:
        redirectToAdminLogin();
        throw new Error("Session expired");
      case 403:
        showToast("Permissão insuficiente para esta ação");
        break;
      case 404:
        throw new NotFoundError(body.error.message);
      case 409:
        throw new ConflictError(body.error);
      default:
        throw new ApiError(body.error);
    }
  }

  return body.data as T;
}
```

---

## 3. Módulo A — Tela de Listagem de Tenants

**Endpoint:** `GET /platform/tenants`

### Shape da resposta

```typescript
interface TenantListItem {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  subscription: {
    id: string;
    status: SubscriptionStatus;
    plan: {
      id: string;
      name: string;
      display_name: string;
      price_cents: number;
      billing_period: "monthly" | "annual";
    };
    current_period_end: string;
    trial_ends_at: string | null;
    past_due_since: string | null;
    cancelled_at: string | null;
  };
  usage: { seats_used: number; integrations_used: number };
  accounts_count: number;
  mrr_cents: number;
}

type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "downgraded"
  | "cancelled"
  | "expired";
```

### Filtros disponíveis

```typescript
// Passa como query string: ?status=past_due&limit=20
const params = new URLSearchParams({
  ...(status ? { status } : {}),
  ...(planId ? { plan_id: planId } : {}),
  ...(search ? { search } : {}),
  ...(cursor ? { cursor } : {}),
  limit: "20",
});
```

### Componente de badge de status

```typescript
const STATUS_CONFIG: Record<SubscriptionStatus, { label: string; color: string }> = {
  active:     { label: 'Ativo',        color: 'green'  },
  trialing:   { label: 'Trial',        color: 'blue'   },
  past_due:   { label: 'Inadimplente', color: 'yellow' },
  downgraded: { label: 'Rebaixado',    color: 'orange' },
  cancelled:  { label: 'Cancelado',    color: 'red'    },
  expired:    { label: 'Expirado',     color: 'gray'   },
};

function StatusBadge({ status }: { status: SubscriptionStatus }) {
  const { label, color } = STATUS_CONFIG[status];
  return <span className={`badge badge-${color}`}>{label}</span>;
}
```

### Exibição de MRR

```typescript
// mrr_cents vem em centavos
function formatMrr(cents: number): string {
  if (cents === 0) return "—";
  return `$${(cents / 100).toFixed(2)}/mo`;
}
```

---

## 4. Módulo A — Tela de Detalhe de Tenant

**Endpoint:** `GET /platform/tenants/:tenant_id`

### Tabs sugeridas

```
[Visão Geral] [Usuários] [Histórico de Planos] [Eventos de Billing]
```

**Visão Geral:** plan atual, status, datas, usage  
**Usuários:** lista de `accounts[]` com role, último login, status ativo  
**Histórico de Planos:** `GET /platform/tenants/:id/subscription-history`  
**Eventos de Billing:** consumir `GET /billing/events` do tenant (não existe ainda no admin, pode usar os dados de `recent_events` do detalhe por enquanto)

### Ações disponíveis na tela de detalhe (botões)

```typescript
// Exibir condicionalmente baseado no status atual:
const showExtendGrace = subscription.status === "past_due" && isSuperAdmin;
const showReactivate = subscription.status === "downgraded" && isSuperAdmin;
const showCancel =
  ["trialing", "active", "past_due"].includes(subscription.status) &&
  isSuperAdmin;
const showForceAssign = isSuperAdmin;
const showImpersonate = isSuperAdmin;
```

---

## 5. Módulo B — Force-Assign e Ações Manuais

### Force-Assign (PUT)

**Endpoint:** `PUT /platform/tenants/:tenant_id/subscription`

Formulário para atribuição de plano manual. Exibir apenas para `super_admin`.

```typescript
// Request body
interface ForceAssignBody {
  plan_id: string; // UUID do plano
  status?: "trialing" | "active";
  current_period_end: string; // ISO 8601 — ex: "2027-04-22T00:00:00.000Z"
  reason: string; // campo de texto livre, obrigatório
}
```

**Validações no formulário:**

- `current_period_end` deve ser data futura
- `reason` obrigatório, mínimo 5 caracteres
- Plano deve ser buscado de `GET /platform/billing/plans?is_active=true`

**Resposta de sucesso:** exibir toast "Plano atribuído com sucesso" e recarregar detalhe do tenant.

### Ações pontuais (PATCH)

**Endpoint:** `PATCH /platform/tenants/:tenant_id/subscription`

```typescript
// Extend Grace — exibir contador no formulário:
// "Adicionar X dias" (slider de 1-30)
interface ExtendGraceBody {
  action: "extend_grace";
  extension_days: number; // 1..30
  reason: string;
}

// Reactivate
interface ReactivateBody {
  action: "reactivate";
  reason: string;
}

// Cancel
interface CancelBody {
  action: "cancel";
  reason: string;
}
```

**Tratamento do 409 (ConflictError):**

O campo `conflict_type` vem em `error.details.conflict_type`:

```typescript
// error shape: { code: "CONFLICT", message: string, details: { conflict_type: string } }
if (error.code === "CONFLICT") {
  const conflictType = error.details?.conflict_type;
  const msg =
    conflictType === "ALREADY_CANCELLED"
      ? "Esta subscription já está cancelada"
      : "O status atual desta subscription não permite esta ação"; // INVALID_STATUS
  showErrorToast(msg);
}
```

---

## 6. Módulo C — Dashboard de Métricas

**Endpoint:** `GET /platform/billing/metrics?period=last_30d`

### Shape da resposta

```typescript
interface MetricsResponse {
  period: "last_30d" | "last_90d" | "last_12m" | "mtd" | "ytd";
  period_start: string;
  period_end: string;
  calculated_at: string;
  mrr_cents: number;
  arr_cents: number;
  subscriptions: {
    total_active: number;
    by_status: Record<SubscriptionStatus, number>;
  };
  period_movements: {
    new_subscriptions: number;
    upgrades: number;
    downgrades: number;
    churned: number;
    reactivated: number;
  };
  churn_rate_percent: number;
  by_plan: Array<{
    plan_id: string;
    plan_name: string;
    plan_display_name: string;
    billing_period: "monthly" | "annual";
    price_cents: number;
    active_subscriptions: number;
    mrr_cents: number;
  }>;
}
```

### Cards de topo sugeridos

```typescript
const topCards = [
  {
    label: "MRR",
    value: formatCents(metrics.mrr_cents),
    subtitle: `ARR: ${formatCents(metrics.arr_cents)}`,
  },
  {
    label: "Tenants ativos",
    value: metrics.subscriptions.total_active,
    subtitle: `${metrics.subscriptions.by_status.trialing} em trial`,
  },
  {
    label: "Churn",
    value: `${metrics.churn_rate_percent}%`,
    alert: metrics.churn_rate_percent > 5, // badge vermelho se > 5%
  },
  {
    label: "Novos este período",
    value: metrics.period_movements.new_subscriptions,
    subtitle: `${metrics.period_movements.upgrades} upgrades`,
  },
];
```

### Alertas automáticos

```typescript
function MetricAlerts({ metrics }: { metrics: MetricsResponse }) {
  return (
    <>
      {metrics.subscriptions.by_status.past_due > 0 && (
        <Alert type="warning">
          {metrics.subscriptions.by_status.past_due} tenant(s) com pagamento pendente —{' '}
          <Link to="/admin/tenants?status=past_due">ver lista</Link>
        </Alert>
      )}
      {metrics.churn_rate_percent > 5 && (
        <Alert type="danger">
          Churn acima de 5% no período ({metrics.churn_rate_percent}%)
        </Alert>
      )}
      {metrics.period_movements.new_subscriptions > 0 && metrics.period_movements.upgrades > metrics.period_movements.downgrades && (
        <Alert type="success">Net revenue expansion positivo no período</Alert>
      )}
    </>
  );
}
```

### Seletor de período

```typescript
const PERIOD_OPTIONS = [
  { value: "last_30d", label: "Últimos 30 dias" },
  { value: "last_90d", label: "Últimos 90 dias" },
  { value: "last_12m", label: "Últimos 12 meses" },
  { value: "mtd", label: "Mês atual (MTD)" },
  { value: "ytd", label: "Ano atual (YTD)" },
];
```

---

## 7. Módulo D — Impersonação

**Endpoint:** `POST /platform/tenants/:tenant_id/impersonate`

### Fluxo completo no frontend

```typescript
async function handleImpersonate(tenantId: string) {
  const reason = prompt(
    "Informe o motivo da impersonação (mínimo 10 caracteres):\n" +
      "Ex: suporte_ticket_#SUP-2026-0422-acme-login-issue",
  );
  if (!reason || reason.length < 10) return;

  const { access_token, expires_at, audit_id } = await adminFetch(
    `/platform/tenants/${tenantId}/impersonate`,
    {
      method: "POST",
      body: JSON.stringify({ reason }),
      headers: { "Content-Type": "application/json" },
    },
  );

  // Armazenar o token de impersonação SEPARADO do token de admin
  // Nunca sobrescrever o token de admin atual
  sessionStorage.setItem("impersonation_token", access_token);
  sessionStorage.setItem("impersonation_expires_at", expires_at);
  sessionStorage.setItem("impersonation_audit_id", audit_id);
  sessionStorage.setItem("impersonation_tenant_id", tenantId);

  // Abrir nova aba/janela com o contexto do tenant
  window.open(`/tenant/${tenantId}?impersonation=true`, "_blank");
}
```

### Banner de impersonação na UI do tenant

Quando a UI do tenant detectar `is_impersonation: true` no JWT, exibir banner permanente:

```typescript
function ImpersonationBanner() {
  const decoded = jwtDecode(getImpersonationToken());
  if (!decoded.is_impersonation) return null;

  const expiresAt = new Date(sessionStorage.getItem('impersonation_expires_at')!);
  const minutesLeft = Math.ceil((expiresAt.getTime() - Date.now()) / 60000);

  return (
    <div className="banner-impersonation">
      ⚠️ Você está visualizando como <strong>org_admin</strong> deste tenant.
      Sessão expira em {minutesLeft} min.
      <button onClick={endImpersonation}>Encerrar</button>
    </div>
  );
}

function endImpersonation() {
  sessionStorage.removeItem('impersonation_token');
  sessionStorage.removeItem('impersonation_expires_at');
  // fechar a aba ou redirecionar de volta ao admin
  window.close();
}
```

### Restrições conhecidas da UI

Durante impersonação, as seguintes ações **devem ser desabilitadas** no frontend (além de serem bloqueadas no backend):

- Formulário de troca de senha
- Formulário de troca de email
- Acesso a qualquer rota `/platform/*`
- Geração de tokens/API keys do próprio admin da plataforma

---

## 8. Navegação sugerida do painel admin

```
/admin
├── /admin/dashboard          → GET /platform/billing/metrics
├── /admin/tenants            → GET /platform/tenants (listagem)
│   └── /admin/tenants/:id    → GET /platform/tenants/:id (detalhe)
│       ├── tab: visão geral
│       ├── tab: usuários
│       ├── tab: histórico de planos
│       └── tab: auditoria de impersonação
├── /admin/billing
│   ├── /admin/billing/plans  → GET /platform/billing/plans (já implementado)
│   └── /admin/billing/metrics → GET /platform/billing/metrics
└── /admin/settings           → configurações da plataforma
```

---

## 9. Referências cruzadas

| Documento                                                                                                    | O que contém                                 |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| [platform-admin-tenants-api.md](./platform-admin-tenants-api.md)                                             | Contratos completos das rotas do Módulo A    |
| [platform-admin-subscriptions-api.md](./platform-admin-subscriptions-api.md)                                 | Contratos completos das rotas do Módulo B    |
| [platform-admin-metrics-api.md](./platform-admin-metrics-api.md)                                             | Contratos e lógica de cálculo do Módulo C    |
| [platform-admin-impersonation-api.md](./platform-admin-impersonation-api.md)                                 | Contratos e payload JWT do Módulo D          |
| [../openapi/platform-admin-v1.yaml](../openapi/platform-admin-v1.yaml)                                       | OpenAPI spec completo com schemas e exemplos |
| [../platform-admin-module-plan.md](../platform-admin-module-plan.md)                                         | Visão geral e sequência de implementação     |
| [../platform-admin-module-a-tenants.md](../platform-admin-module-a-tenants.md)                               | Plano backend do Módulo A                    |
| [../platform-admin-module-b-subscriptions-override.md](../platform-admin-module-b-subscriptions-override.md) | Plano backend do Módulo B                    |
| [../platform-admin-module-c-metrics.md](../platform-admin-module-c-metrics.md)                               | Plano backend do Módulo C                    |
| [../platform-admin-module-d-impersonation.md](../platform-admin-module-d-impersonation.md)                   | Plano backend do Módulo D                    |
