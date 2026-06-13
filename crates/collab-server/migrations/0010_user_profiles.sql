-- Per-account profile: UI preferences (e.g. theme), and an optional avatar.
-- Avatars are stored inline as bounded bytes on the user row (small, resized
-- client-side) and served through a dedicated endpoint; they never enter the
-- vault blob store.
ALTER TABLE users
    ADD COLUMN preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN avatar_bytes BYTEA,
    ADD COLUMN avatar_media_type TEXT,
    ADD COLUMN avatar_updated_at TIMESTAMPTZ;
