-- Catálogo de planos de assinatura — dado global da plataforma, não de
-- tenant (sem RLS de propósito; visibilidade é controlada por is_public,
-- não por tenant_id). Módulo de Billing, Fase 1: só o essencial pra
-- checkout/portal/webhook funcionarem — sem modules/features JSONB ainda,
-- porque não existe nenhum "módulo premium" concreto a gatear hoje.
CREATE TABLE plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL UNIQUE,              -- slug: 'free', 'starter', ...
    display_name VARCHAR(255) NOT NULL,
    price_cents INT NOT NULL DEFAULT 0,
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    billing_period VARCHAR(20) NOT NULL DEFAULT 'monthly',  -- 'monthly' | 'annual'
    stripe_price_id VARCHAR(255),
    trial_days INT NOT NULL DEFAULT 0,
    is_public BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed do plano Free — único que não depende de um Stripe Price ID real
-- (é o plano de provisionamento automático de todo tenant novo).
INSERT INTO plans (name, display_name, price_cents, is_public, is_active)
VALUES ('free', 'Free', 0, TRUE, TRUE);
