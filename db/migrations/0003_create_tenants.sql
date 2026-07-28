-- Tabela raiz do isolamento multi-tenant (.spec/spec-engineering-intelligence.md, Seção 1
-- Princípio 5, e Seção 4.1). Não é tenant-scoped (é a própria raiz), portanto não recebe RLS.
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'SUSPENDED'

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
