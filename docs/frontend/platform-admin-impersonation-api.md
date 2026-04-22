# Platform Admin — Impersonation API

> **Versão:** v1  
> **Status:** 📋 planejado  
> **Permissão base:** `platform_role: super_admin` apenas  
> **Base URL:** `/api/v1`  
> **OpenAPI:** [platform-admin-v1.yaml](../openapi/platform-admin-v1.yaml)

---

## Visão Geral

Permite que um `super_admin` gere um token JWT temporário para agir como `org_admin` de qualquer tenant, sem precisar da senha do usuário. Útil para:

- Suporte técnico: reproduzir problemas reportados pelo cliente
- Debugging: acessar o contexto real de um tenant
- Onboarding assistido: configurar o tenant junto com o cliente

### Restrições de segurança

- Somente `super_admin` pode impersonar — `platform_admin` é bloqueado
- Token tem TTL de **15 minutos** (não renovável)
- Token inclui `is_impersonation: true` e `impersonated_by: <admin_account_id>` no payload
- Token é **rejeitado** em qualquer endpoint `/platform/*` (sem escalada de privilégios)
- Todo uso fica registrado em `ImpersonationAudit`
- `reason` é obrigatório e permanente no log de auditoria

---

## POST /platform/tenants/:tenant_id/impersonate

Gera um JWT de impersonação para o org_admin do tenant especificado.

**Permissão:** `platform_role: super_admin` apenas

### Path params

| Param       | Tipo | Notas                     |
| ----------- | ---- | ------------------------- |
| `tenant_id` | uuid | ID do tenant a impersonar |

### Body

| Campo    | Tipo   | Obrigatório | Notas                                                                   |
| -------- | ------ | ----------- | ----------------------------------------------------------------------- |
| `reason` | string | ✅          | Motivo da impersonação (min 10 chars) — salvo para auditoria permanente |

### Exemplo de request

```json
{
  "reason": "suporte_ticket_#SUP-2026-0422-acme-login-issue"
}
```

### Resposta — 201 Created

```json
{
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expires_at": "2026-04-22T12:45:00.000Z",
    "impersonated_tenant_id": "ten_abc123",
    "impersonated_as_role": "org_admin",
    "audit_id": "imp_xyz789"
  },
  "meta": { "request_id": "...", "version": "1", "timestamp": "..." },
  "error": null
}
```

### Erros

| Status | Código         | Quando                                                            |
| ------ | -------------- | ----------------------------------------------------------------- |
| 400    | `BAD_REQUEST`  | `reason` ausente ou muito curto (< 10 chars)                      |
| 401    | `UNAUTHORIZED` | Token inválido ou ausente                                         |
| 403    | `FORBIDDEN`    | Chamado por `platform_admin` ou usuário de tenant                 |
| 404    | `NOT_FOUND`    | Tenant não encontrado                                             |
| 409    | `CONFLICT`     | Tenant não tem nenhum `org_admin` ativo — impersonação impossível |

---

## Estrutura do JWT de impersonação

```typescript
// Payload do access_token retornado
{
  sub: "acc_org_admin_id",      // ID do org_admin mais antigo (primeiro criado) do tenant
  tenant_id: "ten_abc123",
  roles: ["org_admin"],
  permissions: ["*"],           // org_admin tem permissões totais no tenant
  platform_role: null,          // sem acesso a /platform/*
  is_impersonation: true,       // flag que identifica tokens de impersonação
  impersonated_by: "acc_super_admin_id",  // quem iniciou
  impersonation_audit_id: "imp_xyz789",   // link para o registro de auditoria
  iat: 1745321100,
  exp: 1745322000               // iat + 15 minutos
}
```

---

## Tabela ImpersonationAudit (nova — migration necessária)

```prisma
model ImpersonationAudit {
  id               String    @id @default(uuid())
  initiatedBy      String    // platform account id (super_admin)
  tenantId         String    // tenant impersonado
  impersonatedAs   String    // account id do org_admin usado como subject
  reason           String    // motivo fornecido pelo admin
  tokenIssuedAt    DateTime  @default(now())
  tokenExpiresAt   DateTime  // tokenIssuedAt + 15min
  firstUsedAt      DateTime? // quando o token foi usado pela primeira vez
  createdAt        DateTime  @default(now())

  @@index([initiatedBy])
  @@index([tenantId])
  @@index([tokenIssuedAt])
}
```

> Nota: não há `resolvedAt` ou `revokedAt` — tokens caducam automaticamente por TTL. O campo `firstUsedAt` é atualizado via middleware de autenticação quando o token de impersonação é validado pela primeira vez.

---

## GET /platform/tenants/:tenant_id/impersonation-audit

Lista o histórico de impersonações de um tenant para auditoria de segurança.

**Permissão:** `platform_role: super_admin | platform_admin`

### Query params

| Param    | Tipo    | Default | Notas               |
| -------- | ------- | ------- | ------------------- |
| `limit`  | integer | `20`    | Máx 100             |
| `cursor` | string  | —       | UUID do último item |

### Resposta — 200 OK

```json
{
  "data": {
    "records": [
      {
        "id": "imp_xyz789",
        "initiated_by": {
          "id": "acc_super_001",
          "email": "admin@moasy.tech",
          "full_name": "Moasy Admin"
        },
        "tenant_id": "ten_abc123",
        "reason": "suporte_ticket_#SUP-2026-0422-acme-login-issue",
        "token_issued_at": "2026-04-22T12:30:00.000Z",
        "token_expires_at": "2026-04-22T12:45:00.000Z",
        "first_used_at": "2026-04-22T12:31:10.000Z"
      }
    ],
    "next_cursor": null
  },
  "meta": { "request_id": "...", "version": "1", "timestamp": "..." },
  "error": null
}
```

### Erros

| Status | Código         | Quando                       |
| ------ | -------------- | ---------------------------- |
| 401    | `UNAUTHORIZED` | Token inválido ou ausente    |
| 403    | `FORBIDDEN`    | `platform_role` insuficiente |
| 404    | `NOT_FOUND`    | Tenant não encontrado        |

---

## Notas de implementação

### Middleware de autenticação — validação de token de impersonação

O plugin `auth.ts` precisa detectar tokens de impersonação e:

1. **Rejeitar** em rotas com prefixo `/platform/`:

   ```typescript
   if (decoded.is_impersonation && req.url.startsWith("/api/v1/platform/")) {
     return reply
       .status(403)
       .send(
         fail(
           req,
           "FORBIDDEN",
           "Impersonation tokens cannot access platform admin routes",
         ),
       );
   }
   ```

2. **Registrar primeiro uso** em `ImpersonationAudit.firstUsedAt` (uma vez, idempotente):
   ```typescript
   if (decoded.is_impersonation && decoded.impersonation_audit_id) {
     prisma.impersonationAudit
       .updateMany({
         where: { id: decoded.impersonation_audit_id, firstUsedAt: null },
         data: { firstUsedAt: new Date() },
       })
       .catch(() => {}); // fire-and-forget, não pode bloquear a request
     // ⚠️ updateMany com firstUsedAt: null — apenas o primeiro uso atualiza o campo
   }
   ```

### Seleção do org_admin a impersonar

```typescript
const orgAdmin = await prisma.platformAccount.findFirst({
  where: {
    tenantId,
    role: "org_admin",
    isActive: true,
  },
  orderBy: { createdAt: "asc" }, // primeiro org_admin criado
});

if (!orgAdmin) {
  // Verificar se o tenant existe para diferenciar 404 de 409
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant)
    return reply.status(404).send(fail(req, "NOT_FOUND", "Tenant not found"));
  return reply
    .status(409)
    .send(fail(req, "CONFLICT", "No active org_admin found for this tenant"));
}
```

### Geração do JWT

```typescript
const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // sem date-fns — nativo

const payload = {
  sub: orgAdmin.id,
  tenant_id: tenantId,
  roles: [orgAdmin.role],
  permissions: ["*"],
  platform_role: null,
  is_impersonation: true,
  impersonated_by: req.user.sub,
  impersonation_audit_id: auditRecord.id,
};

const token = app.jwt.sign(payload, { expiresIn: "15m" });
```

---

## Considerações de segurança adicionais

### O que o token de impersonação PODE fazer

- Acessar todos os endpoints `/api/v1/*` (exceto `/platform/*`) como o org_admin do tenant
- Ler dados, criar, atualizar e deletar recursos dentro do tenant

### O que o token de impersonação NÃO PODE fazer

- Acessar `/platform/*` (rejeitado pelo middleware)
- Renovar a si mesmo (não há refresh token)
- Gerar outros tokens de impersonação
- Alterar senha ou email de qualquer conta
- Deletar o tenant ou a subscription

> Para implementar a restrição de alterar senha/email, adicionar verificação em `PATCH /iam/accounts/:id` e `POST /auth/change-password`:
>
> ```typescript
> if (req.user.is_impersonation) {
>   return reply
>     .status(403)
>     .send(
>       fail(
>         req,
>         "FORBIDDEN",
>         "Impersonation tokens cannot modify account credentials",
>       ),
>     );
> }
> ```
