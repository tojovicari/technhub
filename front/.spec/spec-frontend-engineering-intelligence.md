# Spec: Frontend da Plataforma de Engineering Intelligence

> Documento vivo, no mesmo espírito do `.spec/spec-engineering-intelligence.md` do backend: fonte da verdade pra decisões de arquitetura do front. Este diretório (`front/`) foi criado dentro do repo do backend só pra facilitar a escrita/revisão — a intenção é mover ele inteiro pra um repo próprio antes de começar a construção de verdade.

## 1. Visão Geral

Frontend de uma plataforma multi-tenant de Engineering Intelligence (DORA, Flow Metrics, SPACE). Consome a API REST documentada em `api-reference/`. Duas grandes áreas de produto:

1. **Back office** — telas administrativas: autenticação, gestão de tenant/usuários/times, cadastro de integrações (Jira, Linear, GitHub, Waroom, GitHub Actions), configuração semântica (`mapping-rules`), disparo de sincronização/enriquecimento.
2. **Dashboards** — visualização de métricas DORA e Flow (o motivo do produto existir).

**Importante, leia antes de desenhar telas de listagem**: a API de hoje é majoritariamente **escrita** (`POST`). Ver Seção 7 — várias telas óbvias de back office (listar times, listar integrações, ver usuários de um tenant) **não têm endpoint de leitura ainda**. Não é omissão deste spec, é o estado real do backend nesta data.

## 2. Stack Tecnológica (recomendada)

Sem stack pré-definida pelo time — abaixo, minha recomendação e o porquê. Mesma filosofia do backend: TypeScript estrito, o mínimo de dependência que resolve o problema, nada de framework pesado sem necessidade real.

| Camada | Escolha | Por quê |
| --- | --- | --- |
| Framework | **React + Vite** | SPA client-side puro é suficiente — é um produto atrás de login, sem necessidade de SSR/SEO que justifique Next.js e a complexidade extra dele. Vite é rápido e com configuração mínima. |
| Linguagem | **TypeScript, `strict: true`** | Mesmo rigor do backend — nenhuma exceção. |
| Roteamento | **React Router v6** | Padrão de fato do ecossistema React, bem documentado, baixa curva de aprendizado pro time. |
| Dados remotos | **TanStack Query (React Query)** | Cache, retry, invalidação e estados de loading/erro de graça — evita reinventar isso à mão pra cada chamada de API. |
| Estilo | **Tailwind CSS** | Utility-first, zero dependência de biblioteca de componente "caixa preta". |
| Componentes de UI | **shadcn/ui** (Radix UI + Tailwind) | Não é uma dependência tradicional — os componentes são copiados pro seu próprio código (você é dono do componente, não importa um pacote fechado). Bom encaixe com "mínimo de dependência". |
| Gráficos | **Recharts** | Suficiente pros gráficos de linha/barra do DORA/Flow, API declarativa em React. |
| Validação de resposta da API | **Zod** | **Motivo concreto, não teórico**: nesta mesma sessão de desenvolvimento do backend, achamos um bug real de produção causado por confiar cegamente no formato de um JSON armazenado sem validar em runtime (`mapping_rules` salvo num formato antigo, faltando campos que o código assumia que sempre existiam — ver `src/enrichment/rule-evaluator.ts` no backend). Tipos do TypeScript **não existem em runtime** — eles não protegem contra a API devolver algo diferente do esperado (mudança de contrato, bug momentâneo, etc.). Validar a resposta na borda com Zod é a mesma lição aplicada ao front. |

## 3. Autenticação & Sessão

Fluxo completo documentado em `api-reference/auth.md`. Pontos que exigem atenção especial na implementação:

- **Login é redirect de página inteira, não fetch()**: `GET /auth/:provider/login?tenantId=...` devolve um HTTP redirect pro provider OAuth (ex: GitHub). O front deve fazer `window.location.href = ...`, nunca uma chamada AJAX — senão o navegador nunca chega na tela de consentimento do GitHub.
- **Bootstrap do primeiro usuário**: `POST /tenants/:tenantId/users` é a única rota do sistema que não exige token — mas só funciona se o tenant ainda não tiver nenhum usuário (o primeiro usuário criado vira `ADMIN` automaticamente, ignorando qualquer `systemRole` pedido). Depois do primeiro usuário, a mesma rota passa a exigir token de `ADMIN`. A tela de "criar conta"/onboarding precisa lidar com os dois casos.
- **Callback termina em redirect pro front com os tokens na fragment da URL, não em cookie `httpOnly`**: o backend redireciona (`302`) pra `${FRONTEND_URL}/auth/callback#accessToken=...&refreshToken=...&expiresIn=...&user=...` — é o front que precisa ter essa rota `/auth/callback` pra ler `window.location.hash`, guardar a sessão e limpar a URL (`history.replaceState`) logo em seguida. Contrato completo (fragment vs. erro por query string) em `api-reference/auth.md`. Isso significa que **o front é responsável por guardar os dois tokens com cuidado**:
  - `accessToken`: guarde só em memória (estado da aplicação), nunca em `localStorage` — ele é short-lived, o custo de perder no reload (forçando um refresh silencioso) é baixo.
  - `refreshToken`: idealmente também não deveria ficar em `localStorage` (risco de XSS), mas como o backend não oferece cookie `httpOnly` hoje, é a opção disponível. **Registre isso como débito técnico do backend a resolver antes de produção** (mover emissão do refresh token pra um cookie `httpOnly`+`Secure`+`SameSite=Strict`), não como decisão definitiva do front.
- **Refresh silencioso**: `POST /auth/refresh` com `{ tenantId, refreshToken }` devolve um novo `accessToken`. Chame isso antes do access token expirar (ex: num interceptor do cliente HTTP, quando uma chamada volta `401`).
- **Logout**: `POST /auth/logout` revoga o refresh token no backend — sempre chamar antes de limpar o estado local, senão o refresh token continua válido no servidor.

## 4. RBAC (3 papéis)

Mesmo modelo do backend (`CLAUDE.md`), o front deve espelhar isso na UI (esconder/desabilitar ações que o papel do usuário não pode fazer, mesmo sabendo que o backend já rejeita no servidor — defesa em profundidade, mas também UX: não mostrar botão que vai dar 403):

- **`ADMIN`**: acesso total — tenant, faturamento (futuro), integrações, convites, configs globais.
- **`GESTOR`**: gestão de times, configuração semântica (`mapping-rules`) da squad, aliases, visualização de dashboards.
- **`USUARIO`**: só visualização — próprios dados e dashboards dos times que pertence.

Os endpoints de **dashboard** (Seção 6 abaixo) são os únicos acessíveis pelos 3 papéis sem restrição — todo o resto do back office exige `ADMIN` ou `GESTOR` (ver cada rota em `api-reference/admin.md`).

## 5. Mapa de Telas

### 5.1. Buildable hoje, com dado real (a API já devolve o necessário)

| Tela | Endpoint(s) |
| --- | --- |
| Login (redirect OAuth) | `GET /auth/:provider/login` |
| Callback pós-login | `GET /auth/:provider/callback` |
| Onboarding (criar tenant + primeiro admin) | `POST /tenants`, `POST /tenants/:tenantId/users` |
| Convidar usuário | `POST /tenants/:tenantId/users` (com token de ADMIN) |
| Vincular alias de provider a um usuário | `POST /tenants/:tenantId/users/:userId/aliases` |
| Criar time | `POST /tenants/:tenantId/teams` |
| Editar time (nome, capacidade, planning cycle, dias/semana) | `PATCH /tenants/:tenantId/teams/:teamId` |
| Adicionar membro a um time | `POST /tenants/:tenantId/teams/:teamId/members` |
| Editar membro de um time (papel, % de alocação, capacidade customizada) | `PATCH /tenants/:tenantId/teams/:teamId/members/:membershipId` |
| Cadastrar integração (Jira/Linear/GitHub/Waroom/GitHub Actions) | `POST /tenants/:tenantId/integrations` |
| Disparar sincronização de uma integração | `POST /tenants/:tenantId/integrations/:provider/sync` |
| Configurar regras semânticas (org ou time) | `POST /tenants/:tenantId/mapping-rules`, `POST /tenants/:tenantId/teams/:teamId/mapping-rules` |
| Valores brutos observados, pra multi-select em vez de texto livre nas regras | `GET /tenants/:tenantId/mapping-rules/observed-values?field=...` |
| Disparar enriquecimento | `POST /tenants/:tenantId/enrichment/:provider/run` |
| Dashboard DORA (tenant inteiro ou por time via `?teamId=`) | `GET /tenants/:tenantId/dashboard/dora` |
| Dashboard Flow (tenant inteiro ou por time via `?teamId=`) | `GET /tenants/:tenantId/dashboard/flow` |
| Vincular time do Waroom / repo do GitHub a um time da plataforma | `GET /team-resource-links/candidates`, `POST /teams/:teamId/resource-links` |
| Lista de times do tenant | `GET /tenants/:tenantId/teams` |
| Lista de membros de um time (com dado do usuário aninhado) | `GET /tenants/:tenantId/teams/:teamId/members` |
| Lista de usuários do tenant | `GET /tenants/:tenantId/users` |
| Lista de integrações cadastradas + status (sem credenciais) | `GET /tenants/:tenantId/integrations` |
| Ver a regra semântica configurada atualmente, pra editar (org ou time) | `GET /tenants/:tenantId/mapping-rules`, `GET /tenants/:tenantId/teams/:teamId/mapping-rules` |
| Usuários descobertos via sync, pra convidar | `GET /tenants/:tenantId/discovered-users` (convite usa os 2 endpoints de usuário/alias já existentes, não tem `POST` próprio) |

Contrato completo dos `GET` novos: `api-reference/admin.md`. Todos exigem o mesmo RBAC do `POST` irmão (ex: listar times exige `ADMIN`/`GESTOR`, igual criar time). As duas rotas de `mapping-rules` devolvem **exatamente o que está gravado naquele nível** (sem mesclar com fallback de organização/sistema) — `404` se nada foi configurado ainda ali, o que a tela deve tratar como "formulário vazio", não como erro.

**Tela de "usuários descobertos"**: alimentada pelo sync (`POST /tenants/:tenantId/integrations/:provider/sync`) — GitHub/GitHub Actions/Linear costumam vir com nome+avatar, Jira só nome (email variável), Waroom só um ID sem nome (ver `api-reference/admin.md` pra detalhe por provider e o passo a passo do fluxo de convite/vínculo).

### 5.2. Bloqueadas — precisam de endpoint novo no backend antes de existir de verdade

| Tela que faria sentido | O que falta |
| --- | --- |
| Histórico de execuções de sync/enrichment | Nenhum registro histórico é mantido — só o estado mais recente |

**Não construa essa tela com dado mockado achando que "depois troca pela API real"** — combine com o backend antes.

## 6. Dashboards — ver `api-reference/dashboard.md`

Contrato completo, exemplos reais de resposta, e o padrão `available: false` (campo que explica por que uma métrica ainda não pode ser calculada, em vez de vir com erro ou "null" sem explicação) estão documentados lá. Leia antes de desenhar os cards do dashboard — várias métricas clássicas de DORA/Flow (Change Failure Rate, Velocity, Cycle Time) **ainda não têm dado** e a tela precisa de um estado visual pra isso (não é "erro", é "não disponível ainda").

## 7. Padrões de integração com a API

- **Toda rota (exceto bootstrap e as duas de auth com `GET`) exige `Authorization: Bearer <accessToken>`.**
- **Toda rota tenant-scoped valida que o token pertence ao mesmo `:tenantId` da URL** (`403` se não bater) — nunca guarde um token de um tenant e tente usar pra outro.
- **Erros seguem o formato `{ "error": "mensagem" }`**, às vezes com um campo `detail` extra (ex: falha de validação de credencial de integração). Não existe um código de erro estruturado (tipo `"code": "TENANT_NOT_FOUND"`) — a checagem de erro no front precisa ser por status HTTP, não por parsing de mensagem.
- **Nenhuma rota pagina resultados**, incluindo as 5 rotas de listagem novas (`teams`, `members`, `users`, `integrations`) — devolvem o array inteiro do tenant de uma vez. Dado o volume esperado (times/usuários por tenant, não milhares de work items), não foi tratado como prioridade ainda, mas é uma decisão a revisitar se algum tenant crescer muito.
- **CORS já está liberado especificamente pra `FRONTEND_URL`** (dev: `http://localhost:5183`; prod: `https://app.moasy.tech`) — nenhuma outra origem consegue ler as respostas da API. Se o front rodar numa porta diferente de `5183` em dev, ajuste a variável `FRONTEND_URL` do backend, não vai funcionar só trocando a porta do lado do front.

## 8. Estrutura de projeto proposta (repo novo)

```
src/
  api/              # cliente HTTP tipado + schemas Zod por recurso
  auth/             # contexto de sessão, guarda de rota, refresh silencioso
  features/
    dashboard/
    teams/
    integrations/
    mapping-rules/
  components/       # componentes shadcn/ui + composições próprias
  routes/           # definição de rotas (React Router)
```

## 9. Próximos passos

1. Mover este diretório (`front/`) pro repo novo.
2. Criar o projeto Vite + stack acima.
3. Implementar o fluxo de auth primeiro (é pré-requisito de tudo o resto).
4. Implementar as telas da Seção 5.1, na ordem: onboarding → integrações → mapping-rules → dashboards.
5. Levar de volta pro backend a lista de endpoints faltantes (Seção 5.2) pra priorizar a próxima rodada de desenvolvimento.
