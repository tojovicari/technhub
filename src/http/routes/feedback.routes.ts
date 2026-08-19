import type { FastifyInstance } from 'fastify';
import { SlackOpsNotifier } from '../../ops-notifications/slack-ops-notifier';
import { TenantRepository } from '../../identity/tenant.repository';
import { UserRepository } from '../../identity/user.repository';
import { requireAuth } from '../middleware/require-auth';
import { requireSameTenant } from '../middleware/require-same-tenant';

/** Screenshot em base64 costuma passar do limite default do Fastify (1MB). */
const FEEDBACK_BODY_LIMIT_BYTES = 8 * 1024 * 1024;
/** Trunca stack/console logs longos antes de mandar pro Slack — texto livre vindo do front, não confiar no tamanho. */
const MAX_TEXT_BLOCK_CHARS = 3000;

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`[feedback.routes] ${name} não está definida.`);
  }

  return value;
}

interface TenantParams {
  readonly tenantId: string;
}

interface CreateFeedbackBody {
  readonly message?: string;
  readonly screenshotBase64?: string;
  readonly currentUrl?: string;
  /** Mensagem de uma exceção JS capturada no front no momento do feedback (ex: window.onerror/error boundary). */
  readonly errorMessage?: string;
  readonly errorStack?: string;
  /** Texto livre já formatado pelo front (linhas de console.log/warn/error recentes) — não é um array estruturado de propósito, simplicidade nos dois lados. */
  readonly consoleLogs?: string;
}

/** Corta um bloco de texto longo, avisando que foi truncado — nunca confia no tamanho de texto livre vindo do cliente. */
function truncate(text: string): string {
  return text.length > MAX_TEXT_BLOCK_CHARS
    ? `${text.slice(0, MAX_TEXT_BLOCK_CHARS)}\n… (truncado, ${text.length} chars no total)`
    : text;
}

/**
 * `POST /tenants/:tenantId/feedback` — canal de atendimento/feedback:
 * qualquer pessoa logada manda uma mensagem (+ screenshot opcional da
 * tela), o backend repassa pro Slack do operador (`SlackOpsNotifier`).
 *
 * **Sem `requireRole`** — os 3 papéis podem mandar feedback, diferente da
 * maioria das rotas administrativas deste projeto.
 *
 * **Sem persistência nenhuma** — decisão deliberada: o Slack é a única
 * cópia do feedback. Por isso, diferente do padrão best-effort usado pra
 * email de convite (`sendInviteEmailBestEffort`, `users.routes.ts` — o
 * convite já existe no banco antes do email ser só um extra), uma falha
 * de envio aqui vira `502` de verdade pro cliente — engolir o erro
 * significaria perder o feedback sem nenhum rastro.
 */
export function registerFeedbackRoutes(
  server: FastifyInstance,
  slackOpsNotifier: SlackOpsNotifier = new SlackOpsNotifier(),
  tenantRepository: TenantRepository = new TenantRepository(),
  userRepository: UserRepository = new UserRepository(),
): void {
  server.post<{ Params: TenantParams; Body: CreateFeedbackBody }>(
    '/tenants/:tenantId/feedback',
    { preHandler: [requireAuth, requireSameTenant], bodyLimit: FEEDBACK_BODY_LIMIT_BYTES },
    async (request, reply) => {
      const { tenantId } = request.params;
      const { message, screenshotBase64, currentUrl, errorMessage, errorStack, consoleLogs } = request.body;

      if (!message || message.trim().length === 0) {
        return reply.status(400).send({ error: 'O campo "message" é obrigatório.' });
      }

      const [tenant, user] = await Promise.all([
        tenantRepository.findManyByIds([tenantId]).then((tenants) => tenants[0] ?? null),
        userRepository.findById(tenantId, request.user!.userId),
      ]);

      const userAgent = request.headers['user-agent'] ?? 'desconhecido';
      const tenantName = tenant?.name ?? tenantId;
      const reporter = `${user?.fullName ?? '?'} <${request.user!.primaryEmail}> · ${request.user!.systemRole}`;
      const emoji = errorMessage ? '🐛' : '💬';

      // Texto mrkdwn — sempre montado (é o único formato que o Slack aceita
      // como `initial_comment` de upload de arquivo; quando não há
      // screenshot, ainda serve como `text` de fallback junto dos `blocks`).
      const textLines = [
        `${emoji} *Novo feedback* — ${tenantName}`,
        `👤 *De:* ${reporter}`,
        currentUrl ? `📍 *Página:* ${currentUrl}` : null,
        `🖥️ *Navegador:* ${userAgent}`,
        '',
        message
          .trim()
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n'),
        errorMessage ? `\n⚠️ *Exceção capturada:*\n\`${errorMessage}\`` : null,
        errorStack ? `\`\`\`${truncate(errorStack)}\`\`\`` : null,
        consoleLogs ? `\n🧾 *Console (recente):*\n\`\`\`${truncate(consoleLogs)}\`\`\`` : null,
      ].filter((line): line is string => line !== null);
      const text = textLines.join('\n');

      const channelId = requireEnv('SLACK_OPS_FEEDBACK_CHANNEL_ID');
      const result = screenshotBase64
        ? await slackOpsNotifier.postMessageWithFile(channelId, text, {
            buffer: Buffer.from(screenshotBase64, 'base64'),
            filename: `feedback-${Date.now()}.png`,
          })
        : await slackOpsNotifier.postMessage(channelId, text, [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: `${emoji} *Novo feedback* — ${tenantName}` },
            },
            {
              type: 'section',
              fields: [
                { type: 'mrkdwn', text: `*De*\n${reporter}` },
                ...(currentUrl ? [{ type: 'mrkdwn', text: `*Página*\n${currentUrl}` }] : []),
              ],
            },
            { type: 'section', text: { type: 'mrkdwn', text: message.trim() } },
            ...(errorMessage
              ? [{ type: 'section', text: { type: 'mrkdwn', text: `⚠️ *Exceção:*\n\`${errorMessage}\`` } }]
              : []),
            ...(errorStack
              ? [{ type: 'section', text: { type: 'mrkdwn', text: `\`\`\`${truncate(errorStack)}\`\`\`` } }]
              : []),
            ...(consoleLogs
              ? [{ type: 'section', text: { type: 'mrkdwn', text: `🧾 *Console:*\n\`\`\`${truncate(consoleLogs)}\`\`\`` } }]
              : []),
            {
              type: 'context',
              elements: [
                { type: 'mrkdwn', text: `🖥️ ${userAgent} · :clock1: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` },
              ],
            },
          ]);

      if (!result.success) {
        request.log.error(`[feedback.routes] Falha ao enviar feedback pro Slack: ${result.error}`);
        return reply.status(502).send({ error: 'Falha ao enviar feedback, tente novamente.' });
      }

      return reply.status(204).send();
    },
  );
}
