# API Reference — Autenticação

Login é plugável por design (arquitetura `AuthProvider`/`AuthProviderFactory` no backend) — hoje só GitHub está implementado, mas o contrato abaixo já foi desenhado genérico (`:provider` na URL) pra suportar Slack/Teams/Jira/SSO sem quebrar o front depois.

## `GET /auth/:provider/login?tenantId=<uuid>`

**Não é uma chamada de API convencional — é um redirect de página inteira.**

```
window.location.href = `${API_BASE}/auth/github/login?tenantId=${tenantId}`;
```

O backend responde com um `302` pro provider OAuth (ex: tela de consentimento do GitHub). Não dá pra chamar isso via `fetch()`/`axios` esperando um JSON de volta — o navegador precisa navegar de verdade pra essa URL.

- `provider`: hoje só `github`.
- `tenantId`: obrigatório, UUID do tenant. É assim que o backend sabe pra qual tenant emitir o login antes mesmo do usuário se identificar (o `state` do OAuth carrega isso, assinado).
- `400` se `provider` não suportado ou `tenantId` ausente/inválido.

## `GET /auth/:provider/callback?code=&state=`

O provider OAuth redireciona de volta pra esta URL (configurada no app OAuth) depois do consentimento — o navegador chega aqui sozinho, vindo do GitHub. **Você nunca chama essa rota diretamente e nunca lê a resposta dela**: ela sempre termina em `302` de volta pro front, em `${FRONTEND_URL}/auth/callback` (dev: `http://localhost:5183/auth/callback`). É essa rota `/auth/callback` do **front** que você precisa criar pra capturar o resultado.

### Sucesso → `302` com sessão na **fragment** da URL (`#...`, não `?...`)

```
http://localhost:5183/auth/callback#accessToken=eyJhbGci...&refreshToken=...&expiresIn=3600&user=%7B%22id%22...%7D
```

| Parâmetro (todos na fragment) | Formato |
| --- | --- |
| `accessToken` | JWT, cru (não URL-encoded além do necessário) |
| `refreshToken` | token opaco |
| `expiresIn` | segundos, sempre `3600` hoje |
| `user` | `JSON.stringify(user)` passado por `URLSearchParams` (já vem URL-encoded) — mesmo shape de sempre: `{ id, tenantId, primaryEmail, fullName, avatarUrl, systemRole, status, createdAt, updatedAt }` |

Use **fragment**, não query string, de propósito: fragments não são enviados ao servidor em nenhuma requisição subsequente nem aparecem em log de acesso/`Referer` — mais seguro pra carregar tokens. No front, leia com `new URLSearchParams(window.location.hash.slice(1))` e **limpe a URL logo em seguida** (`history.replaceState`) pra não deixar o token pendurado ali se o usuário copiar/compartilhar o link.

### Erro → `302` com `?error=<mensagem>` (query string, sem dado sensível)

```
http://localhost:5183/auth/callback?error=state+inv%C3%A1lido+ou+expirado.+Reinicie+o+login.
```

Motivos possíveis (a mensagem em `error` já vem pronta pra exibir, em português):

| Situação equivalente | Motivo |
| --- | --- |
| (antes seria `400`) | `code`/`state` ausentes, ou `state` inválido/expirado (login demorou demais, reinicie). |
| (antes seria `404`) | Email do GitHub não corresponde a nenhum usuário convidado neste tenant — um `ADMIN` precisa cadastrar o usuário primeiro (`POST /tenants/:tenantId/users`). |
| (antes seria `403`) | Usuário existe, mas está `DISABLED`. |

Não existe mais status HTTP pra distinguir esses casos no front — como tudo chega como `302` (o navegador só vê a URL final de `/auth/callback`), a única forma de saber se deu certo é checar se veio `error` na query ou `accessToken` na fragment.

## `POST /auth/refresh`

```json
// Request
{ "tenantId": "uuid", "refreshToken": "..." }
```

```json
// Resposta 200
{ "accessToken": "novo-token", "expiresIn": 3600 }
```

`401` se o refresh token for inválido, expirado ou já revogado — nesse caso, force novo login (não tem "refresh do refresh").

## `POST /auth/logout`

```json
// Request
{ "tenantId": "uuid", "refreshToken": "..." }
```

`204` (sem corpo) em caso de sucesso — revoga o refresh token no servidor. Chame **antes** de limpar o estado local (senão o token continua válido do lado do backend mesmo depois do usuário "deslogar" na UI).

## Ciclo de vida dos tokens

| Token | Duração | Onde guardar |
| --- | --- | --- |
| `accessToken` | 1 hora | Memória (estado da aplicação) — nunca `localStorage`. |
| `refreshToken` | 30 dias, revogável | Hoje só disponível via `localStorage` (o backend não oferece cookie `httpOnly` ainda — ver nota na Seção 3 do spec principal). Trate como decisão temporária. |
