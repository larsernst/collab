CREATE TABLE IF NOT EXISTS server_metadata (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO server_metadata (key, value)
VALUES ('foundation', '{"status":"ready"}'::jsonb)
ON CONFLICT (key) DO NOTHING;
