-- Phase 5 hosted-vault chat.
--
-- Chat messages are server-authoritative for hosted vaults: the server stamps
-- the authenticated sender and timestamp, and clients provide only message
-- content plus an idempotency key.
CREATE TABLE hosted_chat_messages (
    id UUID PRIMARY KEY,
    vault_id UUID NOT NULL REFERENCES hosted_vaults(id) ON DELETE CASCADE,
    sender_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    content TEXT NOT NULL CHECK (char_length(content) > 0 AND char_length(content) <= 4000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX hosted_chat_messages_vault_idx
    ON hosted_chat_messages(vault_id, created_at DESC);
