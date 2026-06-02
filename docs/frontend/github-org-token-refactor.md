# GitHub org-level token-only (refatoracao backend)

## Contexto

A integracao GitHub passa a operar com onboarding simples em nivel de organizacao usando token.

Objetivo desta mudanca:

- Padronizar frontend e operacao em um unico fluxo.
- Reduzir complexidade de onboarding.
- Manter contrato no mesmo endpoint, sem quebrar rotas existentes.

## Escopo da mudanca

- Backend: conector GitHub suporta `auth_type: token` para sync org-level.
- API: contrato segue em `POST /integrations/connections`.
- Frontend: fluxo GitHub deve usar apenas token.

## Contrato de API (GitHub)

Endpoint:

- `POST /integrations/connections`

Campos obrigatorios para GitHub:

- `tenant_id`
- `provider: "github"`
- `scope.org`
- `credentials.auth_type: "token"`
- `credentials.access_token`

Campos opcionais:

- `scope.repos`

Payload recomendado:

```json
{
  "tenant_id": "tenant-7a4b",
  "provider": "github",
  "scope": { "org": "acme-corp", "repos": ["platform", "api-service"] },
  "credentials": {
    "auth_type": "token",
    "access_token": "<github_pat_or_token>"
  }
}
```

Compatibilidade adicional:

- O backend aceita `credentials.token` como alias legado.
- Para frontend, padrao oficial: sempre enviar `access_token`.

## Impacto no frontend

## 1) Formulario de conexao GitHub

- Remover seletor de autenticacao para GitHub.
- Exibir apenas campo `access_token` (password field).
- Manter `scope.org` obrigatorio e `scope.repos` opcional.

## 2) Validacao no frontend

- Exigir `scope.org` nao vazio.
- Exigir `access_token` nao vazio.
- Enviar `auth_type` fixo como `token`.

## 3) UX recomendada

- Placeholder claro para token de conta tecnica.
- Mensagem de ajuda sobre escopos minimos e rotacao.

## 4) Mensagens de erro esperadas do backend

Casos comuns:

- `GitHub org required in connection scope (scope.org)`
- `GitHub token credentials missing access token (access_token or token)`

## Compatibilidade

Classificacao:

- Non-breaking.

Motivo:

- Contrato e endpoint nao mudaram.
- Apenas padronizamos frontend para um caminho unico (`token`).

## Checklist frontend

- [ ] Remover opcoes de autenticacao GitHub na UI.
- [ ] Enviar `auth_type: "token"` fixo.
- [ ] Enviar `access_token`.
- [ ] Garantir envio de `scope.org`.
- [ ] Atualizar textos de ajuda da tela.
- [ ] Cobrir com testes de formulario no modo token.

## Rollout sugerido

Fase 1:

- Aplicar fluxo token-only em ambientes internos.

Fase 2:

- Habilitar para todos os tenants.
- Monitorar taxa de sucesso de sync GitHub.

## Observacao de seguranca

- Usar conta tecnica dedicada.
- Definir expiracao e rotacao periodica de token.
- Armazenar credenciais com estrategia segura.
