ALTER TABLE users ADD COLUMN is_primary_admin BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE users
SET is_primary_admin = TRUE
WHERE id = COALESCE(
    (
        SELECT target_id::uuid
        FROM audit_events
        WHERE action = 'admin.bootstrap' AND target_type = 'user'
        ORDER BY created_at ASC
        LIMIT 1
    ),
    (
        SELECT id
        FROM users
        WHERE role = 'admin'
        ORDER BY created_at ASC
        LIMIT 1
    )
);

CREATE UNIQUE INDEX users_single_primary_admin_idx
    ON users(is_primary_admin)
    WHERE is_primary_admin;

ALTER TABLE invitations DROP CONSTRAINT invitations_created_by_fkey;
ALTER TABLE invitations ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE invitations
    ADD CONSTRAINT invitations_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
