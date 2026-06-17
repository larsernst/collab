-- Phase 5 live collaboration foundation.
--
-- `ws_tickets` are single-use, short-lived handoff credentials. A client that
-- already holds a browser session or native access token exchanges it for a
-- ticket bound to one vault, then presents the ticket on the WebSocket upgrade
-- so bearer tokens never travel in the WebSocket URL. Tickets are stored hashed
-- (never in plaintext), are consumed on first use, and expire quickly.
CREATE TABLE ws_tickets (
    id UUID PRIMARY KEY,
    ticket_hash TEXT NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vault_id UUID NOT NULL REFERENCES hosted_vaults(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
);

CREATE INDEX ws_tickets_expiry_idx ON ws_tickets(expires_at);

-- Compacted CRDT state per hosted text-backed document. `doc_state` is a Yjs v1
-- encoded update that, applied to an empty document, reproduces the current
-- collaborative state up to (and including) `update_seq`. Live updates beyond
-- that sequence live in `crdt_updates` until a later compaction folds them in.
CREATE TABLE crdt_documents (
    file_id UUID PRIMARY KEY REFERENCES hosted_file_entries(id) ON DELETE CASCADE,
    vault_id UUID NOT NULL REFERENCES hosted_vaults(id) ON DELETE CASCADE,
    doc_state BYTEA NOT NULL,
    protocol_version INTEGER NOT NULL DEFAULT 1,
    update_seq BIGINT NOT NULL DEFAULT 0 CHECK (update_seq >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX crdt_documents_vault_idx ON crdt_documents(vault_id);

-- Append-only log of Yjs v1 updates applied to a document, ordered by `seq`.
-- Replaying `crdt_documents.doc_state` followed by every `crdt_updates` row with
-- a greater sequence reproduces the live document. The log is periodically
-- compacted into `doc_state` (Phase 5 hardening) to bound its growth.
CREATE TABLE crdt_updates (
    id UUID PRIMARY KEY,
    file_id UUID NOT NULL REFERENCES hosted_file_entries(id) ON DELETE CASCADE,
    vault_id UUID NOT NULL REFERENCES hosted_vaults(id) ON DELETE CASCADE,
    seq BIGINT NOT NULL CHECK (seq > 0),
    update_bytes BYTEA NOT NULL,
    author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (file_id, seq)
);

CREATE INDEX crdt_updates_file_idx ON crdt_updates(file_id, seq);
