import type { FastifyInstance, FastifyReply } from 'fastify';
import { AuthProviderFactory } from '../../auth/core/auth-provider.factory';
import {
  signAuthToken,
  signOAuthState,
  signPendingTenantSelection,
  signPlatformOperatorToken,
  verifyOAuthState,
  verifyPendingTenantSelection,
} from '../../auth/core/jwt';
import { RefreshTokenRepository } from '../../auth/core/refresh-token.repository';
import { isPlatformOperator } from '../../auth/core/platform-operator-allowlist';
import { UserRepository } from '../../identity/user.repository';
import { UserEmailDirectoryRepository } from '../../identity/user-email-directory.repository';
import { TenantRepository } from '../../identity/tenant.repository';
import type { Tenant, User } from '../../identity/identity.types';
import { getFrontendUrl } from '../../config/frontend-url';
import { getPlatformAdminRoutePrefix } from '../../config/platform-admin-route-prefix';

const ACCESS_TOKEN_EXPIRES_IN_SECONDS = 60 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Status que permitem completar login — mesmo filtro usado no callback direto e na resolução multi-tenant. */
const LOGINABLE_STATUSES = new Set(['INVITED', 'ACTIVE']);

interface LoginParams {
  readonly provider: string;
}
interface LoginQuery {
  readonly tenantId?: string;
}
interface CallbackParams {
  readonly provider: string;
}
interface CallbackQuery {
  readonly code?: string;
  readonly state?: string;
}
interface SelectTenantBody {
  readonly pendingToken?: string;
  readonly tenantId?: string;
}
interface RefreshBody {
  readonly tenantId?: string;
  readonly refreshToken?: string;
}
interface LogoutBody {
  readonly tenantId?: string;
  readonly refreshToken?: string;
}

/**
 * O callback é acessado via redirect do navegador vindo do GitHub, não via
 * `fetch()` — por isso ele mesmo redireciona pro front em vez de devolver
 * JSON cru (senão o usuário veria uma tela de JSON, não a aplicação).
 *
 * Sucesso: tokens vão na **fragment** da URL (`#...`), não na query string —
 * fragments não são enviados ao servidor em requisições subsequentes nem
 * aparecem em logs de acesso/`Referer`, o que é mais seguro pra um
 * `accessToken`/`refreshToken`. Erros vão na query string (`?error=...`),
 * sem dado sensível.
 */
function redirectToFrontendWithError(reply: FastifyReply, message: string): FastifyReply {
  const url = new URL('/auth/callback', getFrontendUrl());
  url.searchParams.set('error', message);
  return reply.redirect(url.toString());
}

function redirectToFrontendWithSession(
  reply: FastifyReply,
  accessToken: string,
  refreshToken: string,
  user: User,
): FastifyReply {
  const url = new URL('/auth/callback', getFrontendUrl());
  const fragment = new URLSearchParams({
    accessToken,
    refreshToken,
    expiresIn: String(ACCESS_TOKEN_EXPIRES_IN_SECONDS),
    user: JSON.stringify(user),
  });
  return reply.redirect(`${url.toString()}#${fragment.toString()}`);
}

/**
 * Mesmo email logável (`INVITED`/`ACTIVE`) em 2+ tenants — não dá pra emitir
 * token ainda (token sempre carrega exatamente um tenant). `pending=true` é
 * o discriminador que o front usa pra distinguir este caso dos outros dois
 * (erro na query string, sessão na fragment) sem precisar adivinhar pela
 * presença de campos.
 */
function redirectToFrontendWithPendingSelection(
  reply: FastifyReply,
  pendingToken: string,
  tenants: readonly Tenant[],
): FastifyReply {
  const url = new URL('/auth/callback', getFrontendUrl());
  const fragment = new URLSearchParams({
    pending: 'true',
    pendingToken,
    tenants: JSON.stringify(tenants.map((tenant) => ({ id: tenant.id, name: tenant.name }))),
  });
  return reply.redirect(`${url.toString()}#${fragment.toString()}`);
}

/**
 * Sessão do gestor do SaaS — redireciona pra uma rota de front **diferente**
 * de `/auth/callback` (o prefixo não-óbvio de `admin.routes.ts`, mesmo valor
 * de `PLATFORM_ADMIN_ROUTE_PREFIX`), sem nenhum `User`/`tenantId` no payload
 * (não existe nenhum dos dois pra essa identidade).
 */
function redirectToFrontendWithPlatformOperatorSession(
  reply: FastifyReply,
  accessToken: string,
  routePrefix: string,
): FastifyReply {
  const url = new URL(`${routePrefix}/callback`, getFrontendUrl());
  const fragment = new URLSearchParams({
    accessToken,
    expiresIn: String(ACCESS_TOKEN_EXPIRES_IN_SECONDS),
  });
  return reply.redirect(`${url.toString()}#${fragment.toString()}`);
}

function issueAccessToken(user: User): string {
  return signAuthToken({
    userId: user.id,
    tenantId: user.tenantId,
    systemRole: user.systemRole,
    primaryEmail: user.primaryEmail,
  });
}

/**
 * Conclui o login pra um `user`/`tenantId` já resolvidos: checagem de status
 * (defesa em profundidade — `status` pode, em teoria, mudar entre a
 * resolução do candidato e este ponto), `markLoggedIn`, emissão de tokens,
 * redirect com sessão. Compartilhado pelos dois caminhos do callback (atalho
 * de deep-link com tenant já conhecido, e resolução via
 * `user_email_directory` quando só 1 candidato logável sobra).
 */
async function finishLoginForTenant(
  reply: FastifyReply,
  userRepository: UserRepository,
  refreshTokenRepository: RefreshTokenRepository,
  tenantId: string,
  user: User,
  provider: string,
): Promise<FastifyReply> {
  if (user.status === 'DISABLED') {
    return redirectToFrontendWithError(reply, 'Usuário desabilitado.');
  }
  if (user.status === 'DISCOVERED') {
    return redirectToFrontendWithError(
      reply,
      'Este usuário ainda não foi convidado. Peça a um ADMIN para convidar.',
    );
  }

  const activeUser = await userRepository.markLoggedIn(tenantId, user.id, provider);
  const accessToken = issueAccessToken(activeUser);
  const { token: refreshToken } = await refreshTokenRepository.issue(activeUser.tenantId, activeUser.id);

  return redirectToFrontendWithSession(reply, accessToken, refreshToken, activeUser);
}

/**
 * Resolve, pra um email já verificado via OAuth, quais tenants têm um
 * usuário logável (`INVITED`/`ACTIVE`) — nunca inclui tenants onde o email
 * só está `DISCOVERED`/`DISABLED`: listar esses no seletor de workspace
 * transformaria "provar controle do email via OAuth" num jeito de descobrir
 * em quais tenants da plataforma inteira aquele email tem algum rastro, sem
 * nunca ter sido convidado ali. `user_email_directory` só dá os tenant_ids
 * candidatos (índice cross-tenant); o status de verdade sempre vem de
 * `findByEmail` (RLS-scoped, nunca desatualizado).
 */
async function resolveLoginableTenants(
  userRepository: UserRepository,
  emailDirectoryRepository: UserEmailDirectoryRepository,
  email: string,
): Promise<readonly { readonly tenantId: string; readonly user: User }[]> {
  const candidateTenantIds = await emailDirectoryRepository.findTenantIdsByEmail(email);

  const candidates = await Promise.all(
    candidateTenantIds.map(async (tenantId) => ({
      tenantId,
      user: await userRepository.findByEmail(tenantId, email),
    })),
  );

  return candidates.filter(
    (candidate): candidate is { tenantId: string; user: User } =>
      candidate.user !== null && LOGINABLE_STATUSES.has(candidate.user.status),
  );
}

/**
 * Rotas de autenticação — genéricas por design (Seção "login é plugável" do
 * plano): nenhuma delas menciona GitHub. Adicionar um novo `AuthProvider`
 * (Slack, Teams, Jira, ...) não exige tocar neste arquivo.
 */
export function registerAuthRoutes(
  server: FastifyInstance,
  userRepository: UserRepository = new UserRepository(),
  refreshTokenRepository: RefreshTokenRepository = new RefreshTokenRepository(),
  emailDirectoryRepository: UserEmailDirectoryRepository = new UserEmailDirectoryRepository(),
  tenantRepository: TenantRepository = new TenantRepository(),
): void {
  server.get<{ Params: LoginParams; Querystring: LoginQuery }>(
    '/auth/:provider/login',
    async (request, reply) => {
      const { provider } = request.params;
      const { tenantId } = request.query;

      if (!AuthProviderFactory.isRegistered(provider)) {
        return reply.status(400).send({
          error: `Provider "${provider}" não suportado. Disponíveis: ${AuthProviderFactory.listRegistered().join(', ') || 'nenhum'}.`,
        });
      }
      // `tenantId` é opcional — só usado pelo atalho de deep-link (ex: link
      // de convite por email, que já sabe o tenant). No login normal, o
      // tenant é resolvido depois do callback via `user_email_directory`.
      if (tenantId !== undefined && !UUID_PATTERN.test(tenantId)) {
        return reply.status(400).send({ error: 'Query param "tenantId", se enviado, deve ser um UUID válido.' });
      }

      const authProvider = AuthProviderFactory.create(provider);
      const state = signOAuthState(tenantId ? { tenantId, provider } : { provider });

      return reply.redirect(authProvider.buildAuthorizationUrl(state));
    },
  );

  server.get<{ Params: CallbackParams; Querystring: CallbackQuery }>(
    '/auth/:provider/callback',
    async (request, reply) => {
      const { provider } = request.params;
      const { code, state } = request.query;

      if (!code || !state) {
        return redirectToFrontendWithError(reply, 'Parâmetros "code" e "state" são obrigatórios.');
      }

      let statePayload: ReturnType<typeof verifyOAuthState>;
      try {
        statePayload = verifyOAuthState(state);
      } catch {
        return redirectToFrontendWithError(reply, 'state inválido ou expirado. Reinicie o login.');
      }

      if (statePayload.provider !== provider) {
        return redirectToFrontendWithError(reply, 'state não corresponde a este provider.');
      }

      const authProvider = AuthProviderFactory.create(provider);
      const identity = await authProvider.resolveIdentity(code);

      // Gestor do SaaS: identidade alowlisted, sem tenant nenhum envolvido —
      // checado antes de qualquer resolução de tenant, de propósito. Só
      // possível se PLATFORM_ADMIN_ROUTE_PREFIX estiver configurado (senão
      // não tem pra onde redirecionar, e as rotas nem existem mesmo).
      const platformAdminRoutePrefix = getPlatformAdminRoutePrefix();
      if (platformAdminRoutePrefix && isPlatformOperator(identity.externalUserId)) {
        const token = signPlatformOperatorToken({
          purpose: 'platform-operator',
          externalUserId: identity.externalUserId,
          primaryEmail: identity.email,
          name: identity.name,
        });
        return redirectToFrontendWithPlatformOperatorSession(reply, token, platformAdminRoutePrefix);
      }

      // Atalho de deep-link: state já sabia o tenant (ex: link de convite).
      if (statePayload.tenantId) {
        const user = await userRepository.findByEmail(statePayload.tenantId, identity.email);
        if (!user) {
          return redirectToFrontendWithError(
            reply,
            'Nenhum usuário com este email foi convidado para este tenant. Peça a um ADMIN para te cadastrar primeiro.',
          );
        }
        return finishLoginForTenant(reply, userRepository, refreshTokenRepository, statePayload.tenantId, user, provider);
      }

      // Login normal (SSO-first): resolve via user_email_directory quais
      // tenants este email pode de fato logar.
      const loginableCandidates = await resolveLoginableTenants(userRepository, emailDirectoryRepository, identity.email);

      if (loginableCandidates.length === 0) {
        return redirectToFrontendWithError(
          reply,
          'Nenhum usuário com este email foi convidado em nenhum tenant. Peça a um ADMIN para te cadastrar primeiro.',
        );
      }
      if (loginableCandidates.length === 1) {
        const { tenantId, user } = loginableCandidates[0];
        return finishLoginForTenant(reply, userRepository, refreshTokenRepository, tenantId, user, provider);
      }

      const tenants = await tenantRepository.findManyByIds(loginableCandidates.map((candidate) => candidate.tenantId));
      const pendingToken = signPendingTenantSelection({
        purpose: 'pending-tenant-selection',
        email: identity.email,
        provider,
      });
      return redirectToFrontendWithPendingSelection(reply, pendingToken, tenants);
    },
  );

  server.post<{ Body: SelectTenantBody }>('/auth/select-tenant', async (request, reply) => {
    const { pendingToken, tenantId } = request.body;

    if (!pendingToken || !tenantId || !UUID_PATTERN.test(tenantId)) {
      return reply.status(400).send({ error: 'Campos "pendingToken" e "tenantId" (UUID) são obrigatórios.' });
    }

    let payload: ReturnType<typeof verifyPendingTenantSelection>;
    try {
      payload = verifyPendingTenantSelection(pendingToken);
    } catch {
      return reply.status(401).send({ error: 'Seleção de workspace inválida ou expirada. Reinicie o login.' });
    }

    // Nunca confia no `tenantId` vindo do cliente — esta releitura via
    // findByEmail (RLS-scoped) É o gate de autorização: só um tenant onde
    // este email tinha um candidato logável de verdade passa daqui.
    const user = await userRepository.findByEmail(tenantId, payload.email);
    if (!user || !LOGINABLE_STATUSES.has(user.status)) {
      return reply.status(403).send({ error: 'Este tenant não é uma opção válida para este login.' });
    }

    const activeUser = await userRepository.markLoggedIn(tenantId, user.id, payload.provider);
    const accessToken = issueAccessToken(activeUser);
    const { token: refreshToken } = await refreshTokenRepository.issue(activeUser.tenantId, activeUser.id);

    return reply.status(200).send({
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
      user: activeUser,
    });
  });

  server.post<{ Body: RefreshBody }>('/auth/refresh', async (request, reply) => {
    const { tenantId, refreshToken } = request.body;

    if (!tenantId || !refreshToken) {
      return reply.status(400).send({ error: 'Campos "tenantId" e "refreshToken" são obrigatórios.' });
    }

    const verified = await refreshTokenRepository.verify(tenantId, refreshToken);
    if (!verified) {
      return reply.status(401).send({ error: 'Refresh token inválido, expirado ou revogado.' });
    }

    const user = await userRepository.findById(tenantId, verified.userId);
    if (!user || user.status === 'DISABLED') {
      return reply.status(401).send({ error: 'Usuário não encontrado ou desabilitado.' });
    }

    return reply.status(200).send({
      accessToken: issueAccessToken(user),
      expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
    });
  });

  server.post<{ Body: LogoutBody }>('/auth/logout', async (request, reply) => {
    const { tenantId, refreshToken } = request.body;

    if (!tenantId || !refreshToken) {
      return reply.status(400).send({ error: 'Campos "tenantId" e "refreshToken" são obrigatórios.' });
    }

    await refreshTokenRepository.revoke(tenantId, refreshToken);
    return reply.status(204).send();
  });
}
