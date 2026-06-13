-- Fine-grained permission system: reusable capability templates, user groups,
-- and per-vault grants for users and groups. Capabilities are stored as stable
-- dotted-string tokens (see collab_protocol::Capability).

CREATE TABLE permission_templates (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
    capabilities TEXT[] NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_groups (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_group_memberships (
    group_id UUID NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX user_group_memberships_user_idx ON user_group_memberships(user_id);

CREATE TABLE hosted_vault_group_grants (
    vault_id UUID NOT NULL REFERENCES hosted_vaults(id) ON DELETE CASCADE,
    group_id UUID NOT NULL REFERENCES user_groups(id) ON DELETE CASCADE,
    template_id UUID REFERENCES permission_templates(id) ON DELETE SET NULL,
    capabilities TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (vault_id, group_id)
);

CREATE INDEX hosted_vault_group_grants_group_idx ON hosted_vault_group_grants(group_id);

-- Direct memberships may carry an explicit template or capability override; when
-- both are null the membership resolves from its legacy `role` column, so every
-- existing row keeps working with no data migration.
ALTER TABLE hosted_vault_memberships
    ADD COLUMN template_id UUID REFERENCES permission_templates(id) ON DELETE SET NULL,
    ADD COLUMN capabilities TEXT[];

-- Built-in templates reproduce the viewer/editor/admin role ladder. Their
-- capability arrays must stay in sync with collab_protocol::capabilities_for_role.
INSERT INTO permission_templates (id, name, description, is_builtin, capabilities) VALUES
    (
        'a0000000-0000-4000-8000-000000000001',
        'viewer',
        'Read-only access: browse, search, and view history and activity.',
        TRUE,
        ARRAY['vault.read', 'vault.search', 'vault.viewHistory', 'vault.viewActivity']
    ),
    (
        'a0000000-0000-4000-8000-000000000002',
        'editor',
        'Full content editing across files, kanban boards, notes, and canvases.',
        TRUE,
        ARRAY[
            'vault.read', 'vault.search', 'vault.viewHistory', 'vault.viewActivity',
            'file.create', 'file.write', 'file.move', 'file.delete', 'file.uploadAsset',
            'kanban.card.create', 'kanban.card.editContent', 'kanban.card.move',
            'kanban.card.comment', 'kanban.card.delete', 'kanban.card.archive',
            'kanban.column.manage', 'note.edit', 'canvas.edit'
        ]
    ),
    (
        'a0000000-0000-4000-8000-000000000003',
        'admin',
        'Full vault administration including members, permissions, snapshots, and transfer.',
        TRUE,
        ARRAY[
            'vault.read', 'vault.search', 'vault.viewHistory', 'vault.viewActivity',
            'file.create', 'file.write', 'file.move', 'file.delete', 'file.uploadAsset',
            'kanban.card.create', 'kanban.card.editContent', 'kanban.card.move',
            'kanban.card.comment', 'kanban.card.delete', 'kanban.card.archive',
            'kanban.column.manage', 'note.edit', 'canvas.edit',
            'vault.export', 'vault.import', 'vault.manageMembers',
            'vault.managePermissions', 'vault.manageSnapshots'
        ]
    );
