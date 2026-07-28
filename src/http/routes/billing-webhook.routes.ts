import type { FastifyInstance } from 'fastify';
import { getStripeClient } from '../../billing/stripe-client';
import { BillingService } from '../../billing/billing.service';

/**
 * Registra o webhook do Stripe (`POST /webhooks/billing/stripe`) — sem
 * autenticação, verificado só por assinatura HMAC. Registrado dentro de um
 * `server.register` próprio pra que o `addContentTypeParser` (corpo bruto,
 * necessário pra verificação HMAC) fique escopado só a esta rota, sem
 * afetar o parsing JSON normal do resto da API (encapsulamento de plugin
 * do Fastify).
 */
export function registerBillingWebhookRoutes(
  server: FastifyInstance,
  billingService: BillingService = new BillingService(),
): void {
  server.register(async (scoped) => {
    scoped.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => {
      done(null, body);
    });

    scoped.post('/webhooks/billing/stripe', async (request, reply) => {
      const signature = request.headers['stripe-signature'];
      if (!signature || typeof signature !== 'string') {
        return reply.status(400).send({ error: 'Header "stripe-signature" ausente.' });
      }

      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!webhookSecret) {
        request.log.error('[billing-webhook] STRIPE_WEBHOOK_SECRET não está definida.');
        return reply.status(500).send({ error: 'Webhook não configurado.' });
      }

      let event;
      try {
        event = getStripeClient().webhooks.constructEvent(request.body as Buffer, signature, webhookSecret);
      } catch (error) {
        request.log.warn(`[billing-webhook] Assinatura inválida: ${(error as Error).message}`);
        return reply.status(400).send({ error: 'Assinatura do webhook inválida.' });
      }

      try {
        await billingService.handleStripeEvent(event);
      } catch (error) {
        // Erro de negócio: loga, mas devolve 200 mesmo assim — devolver 4xx/5xx
        // aqui faria o Stripe reenviar o mesmo evento em loop (retry storm).
        request.log.error(`[billing-webhook] Falha ao processar evento "${event.type}": ${(error as Error).message}`);
      }

      return reply.status(200).send({ received: true });
    });
  });
}
