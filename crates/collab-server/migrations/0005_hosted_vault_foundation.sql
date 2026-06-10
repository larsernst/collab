CREATE TYPE hosted_vault_status AS ENUM ('active', 'archived', 'pending_delete');
CREATE TYPE hosted_vault_role AS ENUM ('viewer', 'editor', 'admin');
CREATE TYPE hosted_file_kind AS ENUM ('folder', 'document', 'asset');
CREATE TYPE hosted_document_type AS ENUM ('note', 'kanban', 'canvas');
CREATE TYPE hosted_file_state AS ENUM ('active', 'trashed', 'tombstoned');

CREATE TABLE hosted_vaults (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    owner_user_id UUID NOT NULL REFERENCES users(id),
    status hosted_vault_status NOT NULL DEFAULT 'active',
    manifest_sequence BIGINT NOT NULL DEFAULT 0 CHECK (manifest_sequence >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    pending_delete_at TIMESTAMPTZ
);

CREATE INDEX hosted_vaults_owner_idx ON hosted_vaults(owner_user_id);
CREATE INDEX hosted_vaults_status_idx ON hosted_vaults(status);

CREATE TABLE hosted_vault_memberships (
    vault_id UUID NOT NULL REFERENCES hosted_vaults(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role hosted_vault_role NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (vault_id, user_id)
);

CREATE INDEX hosted_vault_memberships_user_idx ON hosted_vault_memberships(user_id);

CREATE TABLE hosted_blobs (
    digest TEXT PRIMARY KEY CHECK (digest ~ '^[0-9a-f]{64}$'),
    size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
    media_type TEXT,
    storage_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE hosted_file_entries (
    id UUID PRIMARY KEY,
    vault_id UUID NOT NULL REFERENCES hosted_vaults(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES hosted_file_entries(id),
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    kind hosted_file_kind NOT NULL,
    document_type hosted_document_type,
    state hosted_file_state NOT NULL DEFAULT 'active',
    current_revision_id UUID,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (kind = 'document' AND document_type IS NOT NULL)
        OR (kind <> 'document' AND document_type IS NULL)
    ),
    UNIQUE (id, vault_id)
);

CREATE UNIQUE INDEX hosted_file_entries_active_sibling_name_idx
    ON hosted_file_entries(vault_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), normalized_name)
    WHERE state = 'active';
CREATE INDEX hosted_file_entries_vault_idx ON hosted_file_entries(vault_id);
CREATE INDEX hosted_file_entries_parent_idx ON hosted_file_entries(parent_id);

CREATE TABLE hosted_file_revisions (
    id UUID PRIMARY KEY,
    vault_id UUID NOT NULL REFERENCES hosted_vaults(id) ON DELETE CASCADE,
    file_id UUID NOT NULL REFERENCES hosted_file_entries(id) ON DELETE CASCADE,
    sequence BIGINT NOT NULL CHECK (sequence > 0),
    blob_digest TEXT NOT NULL REFERENCES hosted_blobs(digest),
    content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (file_id, sequence),
    UNIQUE (id, file_id)
);

ALTER TABLE hosted_file_entries
    ADD CONSTRAINT hosted_file_entries_current_revision_fkey
    FOREIGN KEY (current_revision_id) REFERENCES hosted_file_revisions(id);

CREATE INDEX hosted_file_revisions_vault_idx ON hosted_file_revisions(vault_id);
CREATE INDEX hosted_file_revisions_blob_idx ON hosted_file_revisions(blob_digest);

CREATE TABLE hosted_trash_records (
    file_id UUID PRIMARY KEY REFERENCES hosted_file_entries(id) ON DELETE CASCADE,
    vault_id UUID NOT NULL REFERENCES hosted_vaults(id) ON DELETE CASCADE,
    original_parent_id UUID REFERENCES hosted_file_entries(id),
    original_name TEXT NOT NULL,
    trashed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    trashed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE hosted_snapshots (
    id UUID PRIMARY KEY,
    vault_id UUID NOT NULL REFERENCES hosted_vaults(id) ON DELETE CASCADE,
    file_id UUID NOT NULL REFERENCES hosted_file_entries(id) ON DELETE CASCADE,
    revision_id UUID NOT NULL REFERENCES hosted_file_revisions(id) ON DELETE CASCADE,
    label TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX hosted_snapshots_file_idx ON hosted_snapshots(file_id, created_at DESC);

CREATE TABLE hosted_structural_operations (
    id UUID PRIMARY KEY,
    client_operation_id UUID NOT NULL,
    vault_id UUID NOT NULL REFERENCES hosted_vaults(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    base_manifest_sequence BIGINT NOT NULL CHECK (base_manifest_sequence >= 0),
    result_manifest_sequence BIGINT NOT NULL CHECK (result_manifest_sequence > base_manifest_sequence),
    operation_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (vault_id, client_operation_id),
    UNIQUE (vault_id, result_manifest_sequence)
);

CREATE TABLE hosted_vault_activity_events (
    id UUID PRIMARY KEY,
    vault_id UUID NOT NULL REFERENCES hosted_vaults(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX hosted_vault_activity_vault_idx
    ON hosted_vault_activity_events(vault_id, created_at DESC);
