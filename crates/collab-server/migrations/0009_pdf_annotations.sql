-- Hosted PDF annotation state plus the new fine-grained PDF capabilities.
--
-- PDF annotations (bookmarks, highlights, text annotations, page comments) were
-- previously only persisted in local `.collab/pdf/` sidecars and were disabled
-- entirely for hosted vaults. This makes them server-stored so they can be
-- shared and permission-enforced. Per-user viewer state (last page, zoom) stays
-- client-local and is deliberately not stored here.

-- One annotation document per PDF file, holding the full shared sidecar JSON and
-- a monotonically increasing sequence for optimistic concurrency. This is
-- sidecar metadata attached to a file, so it intentionally does not participate
-- in the vault manifest/revision history of the file content itself.
CREATE TABLE hosted_pdf_annotations (
    vault_id UUID NOT NULL REFERENCES hosted_vaults(id) ON DELETE CASCADE,
    file_id UUID NOT NULL REFERENCES hosted_file_entries(id) ON DELETE CASCADE,
    state JSONB NOT NULL DEFAULT '{}'::jsonb,
    sequence BIGINT NOT NULL DEFAULT 0,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (vault_id, file_id)
);

-- Grant the new PDF capabilities to the built-in editor and admin templates so
-- the default editor experience includes full PDF annotation. These arrays must
-- stay in sync with collab_protocol::capabilities_for_role. Viewers stay
-- read-only (no PDF write capability). Idempotent: only appends tokens that are
-- not already present.
UPDATE permission_templates
SET capabilities = capabilities || ARRAY['pdf.comment', 'pdf.annotate']
WHERE is_builtin
  AND name IN ('editor', 'admin')
  AND NOT (capabilities @> ARRAY['pdf.comment', 'pdf.annotate']);
