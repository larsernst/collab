CREATE TABLE hosted_note_index (
    file_id UUID PRIMARY KEY,
    vault_id UUID NOT NULL,
    revision_id UUID NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT[] NOT NULL DEFAULT '{}',
    search_vector TSVECTOR NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (file_id, vault_id) REFERENCES hosted_file_entries(id, vault_id) ON DELETE CASCADE,
    FOREIGN KEY (revision_id, file_id, vault_id)
        REFERENCES hosted_file_revisions(id, file_id, vault_id) ON DELETE CASCADE
);

CREATE INDEX hosted_note_index_vault_idx ON hosted_note_index(vault_id);
CREATE INDEX hosted_note_index_search_idx ON hosted_note_index USING GIN(search_vector);
