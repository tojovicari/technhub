-- Contador de falhas consecutivas de sync por integração — o `status`
-- sozinho (provider_integrations.status) não distingue "uma falha
-- passageira" de "precisa reconexão manual": markSyncOutcome sempre volta
-- pra ACTIVE no próximo sucesso, então status por si só não tem memória.
-- Alimenta o alerta `integration_reconnect_required`
-- (db/migrations/0046_create_alerts.sql) a partir de um limiar fixo em
-- código — ver ProviderIntegrationRepository.markSyncOutcome e
-- AlertRepository.evaluateReconnectionAlert.
ALTER TABLE provider_integrations
    ADD COLUMN consecutive_failures INT NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0);
