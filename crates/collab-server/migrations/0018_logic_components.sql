CREATE TABLE hosted_logic_components (
    id TEXT PRIMARY KEY,
    vault_id UUID NOT NULL REFERENCES hosted_vaults(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    payload JSONB NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (vault_id, normalized_name)
);

CREATE INDEX hosted_logic_components_vault_name_idx
    ON hosted_logic_components (vault_id, normalized_name);
