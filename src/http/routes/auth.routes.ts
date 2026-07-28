import type { FastifyInstance, FastifyReply } from 'fastify';
import { AuthProviderFactory } from '../../auth/core/auth-provider.factory';
import { signAuthToken, signOAuthState, verifyOAuthState } from '../../auth/core/jwt';
import { RefreshTokenRepository } from '../../auth/core/refresh-token.repository';
import { UserRepository } from '../../identity/user.repository';
import type { User } from '../../identity/identity.types';
import { getFrontendUrl } from '../../config/frontend-url';

const ACCESS_TOKEN_EXPIRES_IN_SECONDS = 60 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function issueAccessToken(user: User): string {
  return signAuthToken({
    userId: user.id,
    tenantId: user.tenantId,
    systemRole: user.systemRole,
    primaryEmail: user.primaryEmail,
  });
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
      if (!tenantId || !UUID_PATTERN.test(tenantId)) {
        return reply.status(400).send({ error: 'Query param "tenantId" é obrigatório e deve ser um UUID válido.' });
      }

      const authProvider = AuthProviderFactory.create(provider);
      const state = signOAuthState({ tenantId, provider });

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

      const user = await userRepository.findByEmail(statePayload.tenantId, identity.email);
      if (!user) {
        return redirectToFrontendWithError(
          reply,
          'Nenhum usuário com este email foi convidado para este tenant. Peça a um ADMIN para te cadastrar primeiro.',
        );
      }
      if (user.status === 'DISABLED') {
        return redirectToFrontendWithError(reply, 'Usuário desabilitado.');
      }
      if (user.status === 'DISCOVERED') {
        return redirectToFrontendWithError(
          reply,
          'Este usuário ainda não foi convidado. Peça a um ADMIN para convidar.',
        );
      }

      const activeUser = await userRepository.markLoggedIn(statePayload.tenantId, user.id);
      const accessToken = issueAccessToken(activeUser);
      const { token: refreshToken } = await refreshTokenRepository.issue(activeUser.tenantId, activeUser.id);

      return redirectToFrontendWithSession(reply, accessToken, refreshToken, activeUser);
    },
  );

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
