export type VaultKind = 'local' | 'hosted';

interface VaultMetaBase {
  id: string;
  name: string;
  path: string;
  lastOpened: number;
  isEncrypted: boolean;
}

export interface LocalVaultMeta extends VaultMetaBase {
  /**
   * Optional while older persisted recent-vault entries are migrated.
   * Missing kinds are always treated as local.
   */
  kind?: 'local';
}

export interface HostedVaultMeta extends VaultMetaBase {
  kind: 'hosted';
  serverUrl: string;
  hostedVaultId: string;
  role: MemberRole;
}

export type VaultMeta = LocalVaultMeta | HostedVaultMeta;

export function vaultKind(vault: VaultMeta): VaultKind {
  return vault.kind ?? 'local';
}

export interface NoteFile {
  relativePath: string;
  name: string;
  extension: string;
  modifiedAt: number;
  size: number;
  isFolder: boolean;
  children?: NoteFile[];
}

export interface NoteContent {
  content: string;
  hash: string;
  modifiedAt: number;
}

export interface WriteResult {
  hash: string;
  mergedContent?: string;
  conflict?: ConflictInfo;
}

export interface RestoreConflictInfo {
  existingRelativePath: string;
  suggestedRelativePath: string;
}

export interface TrashEntry {
  id: string;
  originalRelativePath: string;
  deletedAt: number;
  deletedByUserId?: string | null;
  deletedByUserName?: string | null;
  itemKind: 'file' | 'folder';
  extension?: string | null;
  size: number;
  rootName: string;
  restoreConflict?: RestoreConflictInfo | null;
}

export interface PathChangePreview {
  oldRelativePath: string;
  newRelativePath: string;
  itemKind: 'file' | 'folder';
  operation: 'move' | 'rename' | 'move-and-rename' | 'unchanged';
  nestedItemCount: number;
  affectedReferencePaths: string[];
  blockedReason?: string | null;
}

export type FileReferenceSourceDocumentType = 'note' | 'kanban' | 'canvas';
export type FileReferenceKind =
  | 'note-markdown-link'
  | 'note-wikilink'
  | 'kanban-attachment'
  | 'canvas-file-node'
  | 'canvas-note-node';

export interface FileReference {
  referencedRelativePath: string;
  sourceRelativePath: string;
  sourceDocumentType: FileReferenceSourceDocumentType;
  referenceKind: FileReferenceKind;
  displayLabel?: string | null;
  context?: string | null;
}

export interface ConflictInfo {
  ourContent: string;
  theirContent: string;
  relativePath: string;
}

export type MemberRole = 'viewer' | 'editor' | 'admin';

export interface VaultMember {
  userId: string;
  userName: string;
  role: MemberRole;
}

export interface VaultConfig {
  id: string;
  name: string;
  knownUsers: KnownUser[];
  /** Legacy local-vault metadata. Readable for compatibility, never authoritative. */
  owner?: string;
  /** Legacy local-vault metadata. Readable for compatibility, never authoritative. */
  members?: VaultMember[];
  isEncrypted?: boolean;
}

export interface KnownUser {
  userId: string;
  userName: string;
  userColor: string;
  lastSeen: number;
}
