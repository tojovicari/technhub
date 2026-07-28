import Stripe from 'stripe';

let client: Stripe | null = null;

/**
 * Singleton preguiçoso do SDK oficial do Stripe. Única exceção ao "zero
 * HTTP client" já estabelecido pros conectores de dado — aqui não é uma
 * REST API simples, é o SDK oficial com verificação HMAC de webhook
 * embutida, que não vale a pena reimplementar na mão.
 */
export function getStripeClient(): Stripe {
  if (!client) {
    const apiKey = process.env.STRIPE_SECRET_KEY;

    if (!apiKey) {
      throw new Error('STRIPE_SECRET_KEY não está definida — necessária pro módulo de billing.');
    }

    client = new Stripe(apiKey);
  }

  return client;
}
