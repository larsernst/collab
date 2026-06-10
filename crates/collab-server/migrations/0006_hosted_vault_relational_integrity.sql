ALTER TABLE hosted_file_entries
    DROP CONSTRAINT hosted_file_entries_parent_id_fkey,
    ADD CONSTRAINT hosted_file_entries_parent_same_vault_fkey
        FOREIGN KEY (parent_id, vault_id) REFERENCES hosted_file_entries(id, vault_id);

ALTER TABLE hosted_file_revisions
    DROP CONSTRAINT hosted_file_revisions_file_id_fkey,
    ADD CONSTRAINT hosted_file_revisions_id_file_vault_unique UNIQUE (id, file_id, vault_id),
    ADD CONSTRAINT hosted_file_revisions_file_same_vault_fkey
        FOREIGN KEY (file_id, vault_id) REFERENCES hosted_file_entries(id, vault_id) ON DELETE CASCADE;

ALTER TABLE hosted_file_entries
    DROP CONSTRAINT hosted_file_entries_current_revision_fkey,
    ADD CONSTRAINT hosted_file_entries_current_revision_same_file_fkey
        FOREIGN KEY (current_revision_id, id, vault_id)
        REFERENCES hosted_file_revisions(id, file_id, vault_id);

ALTER TABLE hosted_trash_records
    DROP CONSTRAINT hosted_trash_records_file_id_fkey,
    DROP CONSTRAINT hosted_trash_records_original_parent_id_fkey,
    ADD CONSTRAINT hosted_trash_records_file_same_vault_fkey
        FOREIGN KEY (file_id, vault_id) REFERENCES hosted_file_entries(id, vault_id) ON DELETE CASCADE,
    ADD CONSTRAINT hosted_trash_records_parent_same_vault_fkey
        FOREIGN KEY (original_parent_id, vault_id) REFERENCES hosted_file_entries(id, vault_id);

ALTER TABLE hosted_snapshots
    DROP CONSTRAINT hosted_snapshots_file_id_fkey,
    DROP CONSTRAINT hosted_snapshots_revision_id_fkey,
    ADD CONSTRAINT hosted_snapshots_file_same_vault_fkey
        FOREIGN KEY (file_id, vault_id) REFERENCES hosted_file_entries(id, vault_id) ON DELETE CASCADE,
    ADD CONSTRAINT hosted_snapshots_revision_same_file_fkey
        FOREIGN KEY (revision_id, file_id, vault_id)
        REFERENCES hosted_file_revisions(id, file_id, vault_id) ON DELETE CASCADE;
