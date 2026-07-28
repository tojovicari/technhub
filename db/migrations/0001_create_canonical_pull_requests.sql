-- Camada Canônica: Pull/Merge Requests (GitHub, GitLab).
-- Segue o mesmo padrão de canonical_work_items (.spec/spec-engineering-intelligence.md, Seção 5):
-- chave primária UUID, unicidade por (provider, external_id) para idempotência de sync incremental.
CREATE TABLE canonical_pull_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(50) NOT NULL,              -- 'github', 'gitlab'
    external_id VARCHAR(255) NOT NULL,           -- número do PR no provedor
    repository VARCHAR(255) NOT NULL,            -- 'owner/repo'
    title TEXT NOT NULL,
    state VARCHAR(20) NOT NULL,                  -- 'OPEN', 'MERGED', 'CLOSED'

    author_external_id VARCHAR(255),
    reviewer_external_ids TEXT[] NOT NULL DEFAULT '{}',
    source_branch VARCHAR(255) NOT NULL,
    target_branch VARCHAR(255) NOT NULL,

    lines_added INT NOT NULL DEFAULT 0,
    lines_deleted INT NOT NULL DEFAULT 0,
    comments_count INT NOT NULL DEFAULT 0,

    first_commit_at TIMESTAMP WITH TIME ZONE,
    opened_at TIMESTAMP WITH TIME ZONE NOT NULL,
    merged_at TIMESTAMP WITH TIME ZONE,
    closed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,

    synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_provider_pull_request UNIQUE (provider, external_id)
);

CREATE INDEX idx_canonical_pull_requests_updated_at ON canonical_pull_requests (updated_at);
