-- Lista de arquivos tocados por cada PR — necessário pra detectar "código
-- reescrito pós-merge" (Retrabalho/Code Churn): um PR conta como "churned"
-- se outro PR do mesmo repositório, mergeado depois, tocar algum dos mesmos
-- arquivos. Sem isso não dá pra saber quais arquivos um PR tocou, só o
-- agregado de linhas adicionadas/removidas.
ALTER TABLE canonical_pull_requests
    ADD COLUMN changed_files TEXT[] NOT NULL DEFAULT '{}';

-- GIN pro operador de overlap (&&) usado na query de churn não escanear a
-- tabela inteira a cada verificação de "algum PR depois tocou o mesmo arquivo".
CREATE INDEX idx_canonical_pull_requests_changed_files
    ON canonical_pull_requests USING GIN (changed_files);
