import type { SnapshotMeta } from '../types/collab';
import type { SearchResult } from '../types/note';
import type {
  ConflictInfo,
  LocalVaultMeta,
  NoteFile,
  PathChangePreview,
  TrashEntry,
} from '../types/vault';
import { tauriCommands } from './tauri';

export type VaultClientKind = 'local' | 'hosted';

export interface VaultClientCapabilities {
  nativeFilesystem: boolean;
  filesystemWatch: boolean;
  offlineAccess: boolean;
  encryption: boolean;
  hostedMemberships: boolean;
  authenticatedAssets: boolean;
}

export interface VaultDocument {
  relativePath: string;
  content: string;
  /**
   * Opaque optimistic-lock token. Local clients use a content hash; hosted
   * clients use the canonical server revision sequence.
   */
  version: string;
  modifiedAt: number;
}

export interface VaultWriteResult {
  version: string;
  mergedContent?: string;
  conflict?: ConflictInfo;
}

export interface VaultClient {
  readonly kind: VaultClientKind;
  readonly id: string;
  readonly capabilities: VaultClientCapabilities;

  listFiles(): Promise<NoteFile[]>;
  readDocument(relativePath: string): Promise<VaultDocument>;
  writeDocument(
    relativePath: string,
    content: string,
    expectedVersion?: string,
    baseContent?: string,
  ): Promise<VaultWriteResult>;
  createDocument(relativePath: string): Promise<NoteFile>;
  createFolder(relativePath: string): Promise<void>;
  previewRenameMove(oldPath: string, newPath: string): Promise<PathChangePreview>;
  renameMove(oldPath: string, newPath: string, updateReferences?: boolean): Promise<void>;
  moveToTrash(relativePath: string, removeReferences?: boolean): Promise<TrashEntry>;
  listTrash(): Promise<TrashEntry[]>;
  search(query: string): Promise<SearchResult[]>;
  listSnapshots(relativePath: string): Promise<SnapshotMeta[]>;
  readSnapshot(relativePath: string, snapshotId: string): Promise<string>;
}

export const LOCAL_VAULT_CAPABILITIES: VaultClientCapabilities = {
  nativeFilesystem: true,
  filesystemWatch: true,
  offlineAccess: true,
  encryption: true,
  hostedMemberships: false,
  authenticatedAssets: false,
};

export class LocalVaultClient implements VaultClient {
  readonly kind = 'local';
  readonly capabilities = LOCAL_VAULT_CAPABILITIES;

  constructor(readonly vault: LocalVaultMeta) {}

  get id() {
    return this.vault.id;
  }

  listFiles() {
    return tauriCommands.listVaultFiles(this.vault.path);
  }

  async readDocument(relativePath: string): Promise<VaultDocument> {
    const note = await tauriCommands.readNote(this.vault.path, relativePath);
    return {
      relativePath,
      content: note.content,
      version: note.hash,
      modifiedAt: note.modifiedAt,
    };
  }

  async writeDocument(
    relativePath: string,
    content: string,
    expectedVersion?: string,
    baseContent?: string,
  ): Promise<VaultWriteResult> {
    const result = await tauriCommands.writeNote(
      this.vault.path,
      relativePath,
      content,
      expectedVersion,
      baseContent,
    );
    return {
      version: result.hash,
      mergedContent: result.mergedContent,
      conflict: result.conflict,
    };
  }

  createDocument(relativePath: string) {
    return tauriCommands.createNote(this.vault.path, relativePath);
  }

  createFolder(relativePath: string) {
    return tauriCommands.createFolder(this.vault.path, relativePath);
  }

  previewRenameMove(oldPath: string, newPath: string) {
    return tauriCommands.previewRenameMove(this.vault.path, oldPath, newPath);
  }

  renameMove(oldPath: string, newPath: string, updateReferences?: boolean) {
    return tauriCommands.renameNote(this.vault.path, oldPath, newPath, updateReferences);
  }

  moveToTrash(relativePath: string, removeReferences?: boolean) {
    return tauriCommands.moveNoteToTrash(
      this.vault.path,
      relativePath,
      undefined,
      undefined,
      removeReferences,
    );
  }

  listTrash() {
    return tauriCommands.listTrashEntries(this.vault.path);
  }

  search(query: string) {
    return tauriCommands.searchNotes(this.vault.path, query);
  }

  listSnapshots(relativePath: string) {
    return tauriCommands.listSnapshots(this.vault.path, relativePath);
  }

  readSnapshot(relativePath: string, snapshotId: string) {
    return tauriCommands.readSnapshot(this.vault.path, relativePath, snapshotId);
  }
}

