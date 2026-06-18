-- Phase 6 manifest delta synchronization.
--
-- The vault manifest sequence is global. This per-file marker lets native
-- replicas fetch only file entries whose manifest-visible metadata changed
-- after a known sequence. Existing rows are conservatively marked at the
-- current vault sequence so older replicas perform one full catch-up delta.
ALTER TABLE hosted_file_entries
    ADD COLUMN manifest_sequence BIGINT NOT NULL DEFAULT 0;

UPDATE hosted_file_entries f
SET manifest_sequence = v.manifest_sequence
FROM hosted_vaults v
WHERE f.vault_id = v.id
  AND f.manifest_sequence = 0;

CREATE INDEX hosted_file_entries_manifest_delta_idx
    ON hosted_file_entries(vault_id, manifest_sequence);
