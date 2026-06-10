CREATE TABLE native_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_token_hash TEXT NOT NULL UNIQUE,
    refresh_token_hash TEXT NOT NULL UNIQUE,
    previous_refresh_token_hash TEXT,
    client_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    access_expires_at TIMESTAMPTZ NOT NULL,
    refresh_expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX native_sessions_user_id_idx ON native_sessions(user_id);
CREATE INDEX native_sessions_active_expiry_idx ON native_sessions(refresh_expires_at)
    WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX invitations_normalized_username_pending_idx
    ON invitations(normalized_username)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;
