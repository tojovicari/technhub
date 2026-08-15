-- NULL = retenção ilimitada (nunca expurga), mesma convenção dos 3 tetos
-- de recurso já existentes (max_users/max_teams/max_integrations,
-- 0049_add_resource_limits_to_plans.sql). Sem seed — planos existentes
-- ficam NULL até o gestor do SaaS configurar via PATCH {prefix}/plans/:planId,
-- mesma decisão de não inventar "Free = N meses" em código.
ALTER TABLE plans ADD COLUMN data_retention_months INT;
