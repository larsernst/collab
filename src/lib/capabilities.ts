/**
 * Fine-grained hosted-vault capability catalog for the native permission editor.
 *
 * Mirrors `collab_protocol::Capability` (the server's authoritative token list)
 * and the grouped catalog in `apps/admin-web/src/types.ts`. The admin web app is
 * a separate package and must not be imported from the native frontend, so the
 * catalog is duplicated here. Keep all three in sync when capabilities change.
 */
export const CAPABILITY_GROUPS: Array<{
  domain: string;
  capabilities: Array<{ token: string; label: string }>;
}> = [
  {
    domain: 'Vault',
    capabilities: [
      { token: 'vault.read', label: 'Read' },
      { token: 'vault.search', label: 'Search' },
      { token: 'vault.viewHistory', label: 'View history' },
      { token: 'vault.viewActivity', label: 'View activity' },
      { token: 'vault.export', label: 'Export' },
      { token: 'vault.import', label: 'Import' },
      { token: 'vault.manageMembers', label: 'Manage members' },
      { token: 'vault.managePermissions', label: 'Manage permissions' },
      { token: 'vault.manageSnapshots', label: 'Manage snapshots' },
    ],
  },
  {
    domain: 'Files',
    capabilities: [
      { token: 'file.create', label: 'Create' },
      { token: 'file.write', label: 'Write' },
      { token: 'file.move', label: 'Move / rename' },
      { token: 'file.delete', label: 'Delete' },
      { token: 'file.uploadAsset', label: 'Upload assets' },
    ],
  },
  {
    domain: 'Kanban',
    capabilities: [
      { token: 'kanban.card.create', label: 'Create cards' },
      { token: 'kanban.card.editContent', label: 'Edit card content' },
      { token: 'kanban.card.move', label: 'Move cards' },
      { token: 'kanban.card.comment', label: 'Comment on cards' },
      { token: 'kanban.card.delete', label: 'Delete cards' },
      { token: 'kanban.card.archive', label: 'Archive cards' },
      { token: 'kanban.column.manage', label: 'Manage columns' },
    ],
  },
  {
    domain: 'PDF',
    capabilities: [
      { token: 'pdf.comment', label: 'Add page comments' },
      { token: 'pdf.annotate', label: 'Annotate (bookmarks/highlights)' },
    ],
  },
  {
    domain: 'Documents',
    capabilities: [
      { token: 'note.edit', label: 'Edit notes' },
      { token: 'canvas.edit', label: 'Edit canvases' },
    ],
  },
];

/** Every known capability token, in canonical domain order. */
export const ALL_CAPABILITIES: string[] = CAPABILITY_GROUPS.flatMap((group) =>
  group.capabilities.map((capability) => capability.token),
);

/** The two capabilities that gate hosted member/permission management. */
export const MANAGEMENT_CAPABILITIES = ['vault.manageMembers', 'vault.managePermissions'] as const;

/** Short human-readable label for a capability token (falls back to the raw token). */
export function capabilityLabel(token: string): string {
  for (const group of CAPABILITY_GROUPS) {
    const match = group.capabilities.find((capability) => capability.token === token);
    if (match) return match.label;
  }
  return token;
}

/** Domain-qualified label, e.g. "Files: Write" (falls back to the raw token). */
export function qualifiedCapabilityLabel(token: string): string {
  for (const group of CAPABILITY_GROUPS) {
    const match = group.capabilities.find((capability) => capability.token === token);
    if (match) return `${group.domain}: ${match.label}`;
  }
  return token;
}

/** Sorts tokens into canonical catalog order, dropping unknown tokens. */
export function sortCapabilityTokens(tokens: Iterable<string>): string[] {
  const set = new Set(tokens);
  return ALL_CAPABILITIES.filter((token) => set.has(token));
}
