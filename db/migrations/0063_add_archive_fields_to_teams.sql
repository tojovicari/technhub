-- Arquivar um time (soft delete) — nenhuma FK de teams(id) tem um
-- comportamento seguro pra hard delete hoje (algumas fazem CASCADE
-- destrutivo, outras bloqueiam com erro de FK), então "deletar" um time
-- é um flip de status, não um DELETE FROM teams. Sem coluna de
-- snapshot de propósito — arquivar não guarda dado nenhum, o dado bruto
-- do time segue a mesma política de retenção de sempre (ver
-- RetentionPurgeService); exportar um registro é responsabilidade do
-- front, feito antes de arquivar.
ALTER TABLE teams ADD COLUMN status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE'; -- 'ACTIVE', 'ARCHIVED'
ALTER TABLE teams ADD COLUMN archived_at TIMESTAMP WITH TIME ZONE;
