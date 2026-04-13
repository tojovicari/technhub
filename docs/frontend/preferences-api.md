# Account Preferences API — Frontend Reference

**Base URL:** `/api/v1`  
**Version:** v1  
**Auth:** All endpoints require `Authorization: Bearer <JWT>`

---

## Overview

Preferências são configurações pessoais de um `PlatformAccount` — armazenadas como `jsonb` no banco, tipadas no backend via Zod, e extensíveis sem migrations adicionais.

**Campos iniciais:**

| Campo | Tipo | Default | Descrição |
|---|---|---|---|
| `locale` | string | `"pt-BR"` | Idioma da interface (`"pt-BR"`, `"en-US"`, etc.) |
| `theme` | string | `"system"` | Tema visual (`"light"`, `"dark"`, `"system"`) |

> O campo `preferences` é retornado em `GET /auth/me` e atualizado via `PATCH /auth/me/preferences`.  
> Campos não enviados no PATCH são preservados (merge parcial).

---

## Endpoints

---

### GET /auth/me

Retorna o perfil completo do account autenticado, incluindo `preferences`.

**Auth:** `Authorization: Bearer <access_token>`

**Response — 200 OK:**

```json
{
  "data": {
    "id": "29f95970-c13d-4ece-a8f3-55db7b2f410f",
    "tenant_id": "acme-corp",
    "email": "glauber@example.com",
    "full_name": "Glauber Vicari",
    "role": "org_admin",
    "is_active": true,
    "core_user_id": "usr-abc123",
    "last_login_at": "2026-04-13T10:00:00Z",
    "created_at": "2026-04-09T19:09:42Z",
    "preferences": {
      "locale": "pt-BR",
      "theme": "dark"
    }
  },
  "meta": { "request_id": "req-5", "version": "v1", "timestamp": "2026-04-13T10:00:00Z" },
  "error": null
}
```

> `preferences` é `null` para accounts criados antes da feature. Trate como defaults no frontend:
> ```ts
> const locale = account.preferences?.locale ?? 'pt-BR';
> const theme  = account.preferences?.theme  ?? 'system';
> ```

---

### PATCH /auth/me/preferences

Atualiza as preferências do account autenticado. **Merge parcial** — apenas os campos enviados são atualizados.

**Auth:** `Authorization: Bearer <access_token>`

**Request Body (todos opcionais):**

| Campo | Tipo | Valores aceitos |
|---|---|---|
| `locale` | string | `"pt-BR"` \| `"en-US"` \| `"es-ES"` |
| `theme` | string | `"light"` \| `"dark"` \| `"system"` |

**Request Example — mudar só o tema:**

```json
{
  "theme": "dark"
}
```

**Request Example — mudar tudo:**

```json
{
  "locale": "en-US",
  "theme": "light"
}
```

**Response — 200 OK:**

```json
{
  "data": {
    "preferences": {
      "locale": "pt-BR",
      "theme": "dark"
    }
  },
  "meta": { "request_id": "req-pref1", "version": "v1", "timestamp": "2026-04-13T10:01:00Z" },
  "error": null
}
```

**Error Scenarios:**

| Status | Code | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Valor inválido para `locale` ou `theme` |
| 401 | `UNAUTHORIZED` | Token ausente ou inválido |

---

## Implementação Frontend

### Inicialização

Leia `preferences` de `GET /auth/me` no bootstrap do app e aplique ao contexto global:

```ts
const me = await api.get('/auth/me');
const prefs = me.data.preferences ?? { locale: 'pt-BR', theme: 'system' };

i18n.setLocale(prefs.locale);
applyTheme(prefs.theme);
```

### Atualizar preferência única

```ts
async function updateTheme(theme: 'light' | 'dark' | 'system') {
  const res = await api.patch('/auth/me/preferences', { theme });
  applyTheme(res.data.preferences.theme);
}
```

### Atualizar idioma

```ts
async function updateLocale(locale: 'pt-BR' | 'en-US' | 'es-ES') {
  const res = await api.patch('/auth/me/preferences', { locale });
  i18n.setLocale(res.data.preferences.locale);
}
```

### Valores aceitos

```ts
export const SUPPORTED_LOCALES = ['pt-BR', 'en-US', 'es-ES'] as const;
export const SUPPORTED_THEMES  = ['light', 'dark', 'system'] as const;

export type Locale = typeof SUPPORTED_LOCALES[number];
export type Theme  = typeof SUPPORTED_THEMES[number];
```

---

## Extensibilidade

Para adicionar novos campos de preferência:
- **Backend:** adicionar o campo ao tipo `AccountPreferences` e ao schema Zod de validação
- **Banco:** nenhuma migration necessária — é `jsonb`
- **Frontend:** campo disponível automaticamente em `preferences` após deploy

Exemplos de campos futuros: `density` (`comfortable` | `compact`), `notifications` (`{ email: boolean, slack: boolean }`), `date_format`, `currency`.

---

## Status

> **Planejado — não implementado ainda.**  
> Schema, migration, service e routes ainda não foram criados.  
> Este documento descreve o contrato acordado para guiar a implementação.
