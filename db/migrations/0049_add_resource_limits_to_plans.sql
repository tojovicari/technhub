-- Teto opcional de recursos por plano. NULL = ilimitado (comportamento
-- atual preservado por padrão) — sem CHECK, sem NOT NULL, NULL não é um
-- sentinel mágico aqui, é o valor "sem limite" de verdade.
--
-- Nenhum seed: planos existentes (inclusive 'free') ficam NULL até o
-- gestor do SaaS configurar valores reais via PATCH {prefix}/plans/:planId
-- — não é decisão de código inventar "Free = N usuários".
ALTER TABLE plans
    ADD COLUMN max_users INT,
    ADD COLUMN max_teams INT,
    ADD COLUMN max_integrations INT;
