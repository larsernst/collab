-- Phase 5 hosted-vault coarse presence.
--
-- This backs the regular Peers sidebar/status bar for hosted vaults. It is
-- intentionally ephemeral: rows are overwritten by each heartbeat and old rows
-- are ignored by readers rather than treated as durable collaboration history.
CREATE TABLE hosted_presence (
    vault_id UUID NOT NULL REFERENCES hosted_vaults(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    active_file TEXT,
    cursor_line INTEGER,
    chat_typing_until BIGINT,
    app_version TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (vault_id, user_id)
);

CREATE INDEX hosted_presence_active_idx
    ON hosted_presence(vault_id, updated_at DESC);
