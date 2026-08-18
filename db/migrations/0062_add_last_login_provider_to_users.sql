-- Registra qual AuthProvider foi usado no login mais recente de cada
-- usuário (github/google/microsoft/slack/...) — mesmo espírito de
-- last_login_at (0006_create_users.sql), gravado no mesmo momento
-- (finishLoginForTenant/select-tenant, ver auth.routes.ts). NULL pra quem
-- nunca logou ainda (DISCOVERED/INVITED).
ALTER TABLE users ADD COLUMN last_login_provider VARCHAR(50);
