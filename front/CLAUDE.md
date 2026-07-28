# Contexto do Projeto: Frontend da Plataforma de Engineering Intelligence

Você é um Engenheiro de Software Sênior atuando no frontend de uma plataforma de Engineering Intelligence (DORA, Flow Metrics e SPACE). O desenvolvimento deste projeto é **Spec-Driven**, no mesmo espírito do backend que esta API consome. NUNCA invente telas, fluxos ou contratos de API que não estejam na especificação oficial.

## 📌 Documentação Oficial

- **Spec do produto/arquitetura de front**: `.spec/spec-frontend-engineering-intelligence.md` — leia sempre antes de propor uma tela ou fluxo novo.
- **Contratos de API** (fonte da verdade pra toda chamada HTTP): `.spec/api-reference/auth.md`, `.spec/api-reference/admin.md`, `.spec/api-reference/dashboard.md`.
- Se um contrato de API parecer errado ou incompleto durante o desenvolvimento, **não adivinhe o formato** — pare e pergunte, ou teste contra o backend rodando localmente e atualize o `.spec/api-reference/` correspondente (mesma prática de manter spec e código sincronizados usada no backend).

## ⚠️ Antes de construir qualquer tela de listagem

A API hoje é majoritariamente **escrita** (`POST`), não leitura. Antes de implementar uma tela que dependeria de um `GET` que não está documentado em `.spec/api-reference/`, confira a Seção 5.2 do spec principal ("Bloqueadas — precisam de endpoint novo no backend"). Não mocke dado achando que "depois troca pela API real" sem alinhar antes qual endpoint o backend vai criar.

## 🏗️ Princípios de Arquitetura

1. **SPA client-side, sem SSR** — é um produto atrás de login, sem necessidade de SEO. Nada de framework meta (Next.js e afins) sem uma razão concreta pra precisar de SSR.
2. **Autenticação é redirect de página inteira** pro `/auth/:provider/login`, não uma chamada `fetch()` — ver `.spec/api-reference/auth.md`.
3. **`accessToken` só em memória, nunca em `localStorage`.** `refreshToken` é uma exceção temporária documentada no spec (débito técnico do backend) — não trate como padrão a repetir se o backend passar a oferecer cookie `httpOnly`.
4. **Toda resposta de API que alimenta uma decisão de UI passa por validação Zod na borda** — nunca confie que o formato TypeScript esperado bate com o que a API realmente devolveu em runtime (motivo concreto documentado no spec principal, Seção 2).
5. **RBAC espelhado na UI**: esconda/desabilite ações que o papel do usuário logado (`ADMIN`/`GESTOR`/`USUARIO`) não teria permissão de fazer no backend — não é só o backend que valida (403), a UI não deveria nem oferecer o botão.
6. **Campos `available: false` na API de dashboard não são erro** — são um estado de produto ("essa métrica ainda não existe"), precisam de um estado visual próprio, não um toast de erro.

## 🧑‍💻 Regras de Código (TypeScript / React)

- **Tipagem Estrita**: `strict: true` no `tsconfig.json`, sem exceção.
- **Componentes de UI**: `shadcn/ui` (Radix + Tailwind) — os componentes são copiados pro projeto, não importados como pacote fechado; sinta-se livre pra adaptar, mas mantenha a acessibilidade que o Radix já garante.
- **Dados remotos**: sempre via TanStack Query — nunca `useEffect` + `fetch` cru pra buscar dado de API.
- **Cliente HTTP**: uma camada fina e tipada em `src/api/`, um arquivo por recurso (`auth.ts`, `teams.ts`, `integrations.ts`, `mapping-rules.ts`, `dashboard.ts`), cada um exportando funções que já devolvem o tipo validado por Zod — nenhum outro lugar do código deveria chamar `fetch()` diretamente.

## 🛠️ Comandos Frequentes (a definir quando o projeto for inicializado)

- Dev: `npm run dev` (Vite)
- Build: `npm run build`
- Lint: `npm run lint`
- Testes: a definir — sem framework de teste ainda decidido pro front.

## 🛠️ Stack (ver justificativa completa em `.spec/spec-frontend-engineering-intelligence.md`, Seção 2)

React + Vite + TypeScript estrito, React Router, TanStack Query, Tailwind, shadcn/ui, Recharts, Zod.

## 🔌 Backend local e produção

Durante o desenvolvimento, o backend roda em `http://localhost:3000` (`npm run dev` no repo do backend) e o front em `http://localhost:5183` — essa dupla é o que o backend espera em `FRONTEND_URL` (CORS + redirect do callback OAuth), então rodar o front noutra porta em dev exige ajustar essa variável do lado do backend também.

Em produção (Fly.io): API em `https://api.moasy.tech`, front em `https://app.moasy.tech`. A URL base da API deve ser uma variável de ambiente (`VITE_API_BASE_URL` ou equivalente), nunca hardcoded.
