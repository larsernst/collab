import type { SnapshotMeta } from '../types/collab';
import type { NoteMetadata, SearchResult } from '../types/note';
import type { PdfSidecarState } from '../types/pdf';
import type {
  ConflictInfo,
  FileReference,
  HostedVaultMember,
  HostedVaultMeta,
  LocalVaultMeta,
  MemberRole,
  NoteFile,
  PathChangePreview,
  TrashEntry,
  UserDirectoryEntry,
  VaultMeta,
} from '../types/vault';
import { vaultKind } from '../types/vault';
import { tauriCommands } from './tauri';

export type VaultClientKind = 'local' | 'hosted';

export interface VaultClientCapabilities {
  nativeFilesystem: boolean;
  filesystemWatch: boolean;
  offlineAccess: boolean;
  encryption: boolean;
  hostedMemberships: boolean;
  authenticatedAssets: boolean;
  destructiveSnapshotHistory: boolean;
}

export interface VaultWatchCapability {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface VaultEncryptionCapability {
  unlock(password: string): Promise<void>;
  enable(password: string): Promise<void>;
  disable(password: string): Promise<void>;
  changePassword(oldPassword: string, newPassword: string): Promise<void>;
}

export interface ExternalAssetImportCapability {
  /** Import a desktop file (drag-drop / file dialog) and return its vault relative path. */
  import(sourcePath: string, targetFolder?: string): Promise<string>;
  /** Import in-memory bytes from a `data:` URL (clipboard paste) and return its vault relative path. */
  importData(dataUrl: string, suggestedName: string, targetFolder?: string): Promise<string>;
}

export interface VaultArchiveExportCapability {
  exportTo(destinationPath: string): Promise<void>;
}

/**
 * Server-authoritative membership management for hosted vaults. Not available for
 * local vaults, which no longer use role authorization.
 */
export interface VaultMembersCapability {
  list(): Promise<HostedVaultMember[]>;
  searchDirectory(query: string): Promise<UserDirectoryEntry[]>;
  add(userId: string, role: MemberRole): Promise<HostedVaultMember>;
  updateRole(userId: string, role: MemberRole): Promise<HostedVaultMember>;
  remove(userId: string): Promise<void>;
}

export interface VaultRuntimeCapabilities {
  watch?: VaultWatchCapability;
  encryption?: VaultEncryptionCapability;
  externalAssetImport?: ExternalAssetImportCapability;
  archiveExport?: VaultArchiveExportCapability;
  members?: VaultMembersCapability;
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

export interface VaultPdfAnnotations {
  state: PdfSidecarState;
  /**
   * Optimistic-lock token for hosted vaults (the server-side annotation
   * sequence). `null` for local vaults, whose sidecars are not versioned.
   */
  version: number | null;
}

export interface VaultClient {
  readonly kind: VaultClientKind;
  readonly id: string;
  readonly capabilities: VaultClientCapabilities;
  readonly runtime: VaultRuntimeCapabilities;

  listFiles(): Promise<NoteFile[]>;
  /**
   * Note metadata index used for wikilinks, backlinks, graph, and search.
   * Local vaults build a full content-derived index on disk; hosted vaults
   * derive a lightweight path/title index from the manifest (content-derived
   * fields such as wikilinks/tags/wordCount are not populated for hosted).
   */
  buildNoteIndex(): Promise<NoteMetadata[]>;
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
  deletePermanently(relativePath: string, removeReferences?: boolean): Promise<void>;
  listReferences(relativePath: string): Promise<FileReference[]>;
  listTrash(): Promise<TrashEntry[]>;
  restoreTrash(entryId: string, targetRelativePath?: string): Promise<void>;
  purgeTrash(entryId: string, removeReferences?: boolean): Promise<void>;
  purgeAllTrash(): Promise<void>;
  search(query: string): Promise<SearchResult[]>;
  createSnapshot(
    relativePath: string,
    content: string,
    authorId: string,
    authorName: string,
    label?: string,
  ): Promise<SnapshotMeta>;
  listSnapshots(relativePath: string): Promise<SnapshotMeta[]>;
  readSnapshot(relativePath: string, snapshotId: string): Promise<string>;
  restoreSnapshot(relativePath: string, snapshotId: string, authorId: string, authorName: string): Promise<VaultWriteResult>;
  deleteSnapshot(relativePath: string, snapshotId: string): Promise<void>;
  clearSnapshotHistory(relativePath: string): Promise<void>;
  /**
   * Returns a `data:` URL for a vault asset (image, PDF, …). Local vaults read
   * from disk; hosted vaults stream the blob through the authenticated gateway
   * so bearer tokens never reach the webview.
   */
  readAssetDataUrl(relativePath: string): Promise<string>;
  /**
   * Reads the shared annotation sidecar for a PDF. Local vaults read the
   * filesystem sidecar under `.collab/pdf/`; hosted vaults read the
   * server-stored, permission-enforced annotation document. Per-user viewer
   * state (last page, zoom) is only round-tripped for local vaults.
   */
  readPdfAnnotations(relativePath: string): Promise<VaultPdfAnnotations>;
  /**
   * Writes the shared annotation sidecar for a PDF. `expectedVersion` is the
   * optimistic-lock token from the last read (hosted only; pass `null` for
   * local). Hosted writes are semantically permission-enforced: page-comment
   * changes require `pdf.comment`, other annotation changes require
   * `pdf.annotate`.
   */
  writePdfAnnotations(
    relativePath: string,
    state: PdfSidecarState,
    expectedVersion: number | null,
  ): Promise<VaultPdfAnnotations>;
}

export const LOCAL_VAULT_CAPABILITIES: VaultClientCapabilities = {
  nativeFilesystem: true,
  filesystemWatch: true,
  offlineAccess: true,
  encryption: true,
  hostedMemberships: false,
  authenticatedAssets: false,
  destructiveSnapshotHistory: true,
};

export const HOSTED_VAULT_CAPABILITIES: VaultClientCapabilities = {
  nativeFilesystem: false,
  filesystemWatch: false,
  offlineAccess: false,
  encryption: false,
  hostedMemberships: true,
  authenticatedAssets: true,
  destructiveSnapshotHistory: false,
};

type HostedFileKind = 'folder' | 'document' | 'asset';
type HostedFileState = 'active' | 'trashed' | 'tombstoned';
type HostedDocumentType = 'note' | 'kanban' | 'canvas';

interface HostedRevision {
  id: string;
  sequence: number;
  contentHash: string;
  sizeBytes: number;
  createdByDisplayName: string | null;
  createdAt: string;
}

interface HostedFileEntry {
  id: string;
  parentId: string | null;
  name: string;
  relativePath: string;
  kind: HostedFileKind;
  documentType: HostedDocumentType | null;
  state: HostedFileState;
  currentRevision: HostedRevision | null;
  createdAt: string;
  updatedAt: string;
}

interface HostedManifest {
  vaultId: string;
  sequence: number;
  files: HostedFileEntry[];
}

interface HostedTextDocument {
  file: HostedFileEntry;
  content: string;
}

interface HostedSnapshot {
  id: string;
  label: string | null;
  revision: HostedRevision;
  createdByDisplayName: string | null;
  createdAt: string;
}

interface HostedRevisionContent {
  revision: HostedRevision;
  content: string;
}

interface HostedSearchResult {
  relativePath: string;
  title: string;
  excerpt: string;
  rank: number;
}

interface HostedOperationPreview {
  oldRelativePath: string;
  newRelativePath: string | null;
  itemKind: HostedFileKind;
  nestedItemCount: number;
  affectedDocuments: Array<{ relativePath: string }>;
  blockedReason: string | null;
}

interface HostedFileReference extends FileReference {
  sourceFileId: string;
  referencedFileId: string | null;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Coerces a server-stored annotation JSON object into a `PdfSidecarState`,
 * tolerating missing collections. Server state never carries viewer state, so it
 * resolves to null and stays client-local.
 */
function normalizeAnnotationState(state: Record<string, unknown> | null | undefined): PdfSidecarState {
  return {
    bookmarks: asArray(state?.bookmarks),
    highlights: asArray(state?.highlights),
    textAnnotations: asArray(state?.textAnnotations),
    pageComments: asArray(state?.pageComments),
    viewerState: null,
  };
}

function extension(path: string): string {
  const name = path.split('/').pop() ?? path;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function documentTypeForPath(path: string): HostedDocumentType {
  const ext = extension(path);
  if (ext === 'kanban') return 'kanban';
  if (ext === 'canvas') return 'canvas';
  return 'note';
}

function toNoteFile(entry: HostedFileEntry): NoteFile {
  return {
    relativePath: entry.relativePath,
    name: entry.name,
    extension: entry.kind === 'folder' ? '' : extension(entry.name),
    modifiedAt: timestamp(entry.updatedAt),
    size: entry.currentRevision?.sizeBytes ?? 0,
    isFolder: entry.kind === 'folder',
  };
}

function buildFileTree(entries: HostedFileEntry[]): NoteFile[] {
  const active = entries.filter((entry) => entry.state === 'active');
  const mapped = new Map(active.map((entry) => [entry.id, toNoteFile(entry)]));
  const roots: NoteFile[] = [];
  for (const entry of active) {
    const item = mapped.get(entry.id)!;
    if (entry.parentId && mapped.get(entry.parentId)?.isFolder) {
      const parent = mapped.get(entry.parentId)!;
      parent.children ??= [];
      parent.children.push(item);
    } else {
      roots.push(item);
    }
  }
  const sort = (items: NoteFile[]) => {
    items.sort((a, b) => Number(b.isFolder) - Number(a.isFolder) || a.name.localeCompare(b.name));
    for (const item of items) if (item.children) sort(item.children);
  };
  sort(roots);
  return roots;
}

function splitDestination(path: string): { parentPath: string; name: string } {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  if (!name) throw new Error('A hosted vault path must include a file or folder name.');
  return { parentPath: parts.join('/'), name };
}

function pathOperation(oldPath: string, newPath: string): PathChangePreview['operation'] {
  const oldDestination = splitDestination(oldPath);
  const newDestination = splitDestination(newPath);
  const moved = oldDestination.parentPath !== newDestination.parentPath;
  const renamed = oldDestination.name !== newDestination.name;
  if (moved && renamed) return 'move-and-rename';
  if (moved) return 'move';
  if (renamed) return 'rename';
  return 'unchanged';
}

export class HostedVaultClient implements VaultClient {
  readonly kind = 'hosted';
  readonly capabilities = HOSTED_VAULT_CAPABILITIES;
  readonly runtime: VaultRuntimeCapabilities;

  constructor(readonly vault: HostedVaultMeta) {
    this.runtime = {
      externalAssetImport: {
        import: (sourcePath, targetFolder) => this.uploadExternalAsset(sourcePath, targetFolder),
        importData: (dataUrl, suggestedName, targetFolder) =>
          this.uploadDataUrl(dataUrl, suggestedName, targetFolder),
      },
      members: {
        list: () => this.request<HostedVaultMember[]>('GET', '/members'),
        searchDirectory: (query) =>
          tauriCommands.hostedUserDirectory(this.vault.serverUrl, query),
        add: (userId, role) =>
          this.request<HostedVaultMember>('POST', '/members', { userId, role }),
        updateRole: (userId, role) =>
          this.request<HostedVaultMember>('PATCH', `/members/${encodeURIComponent(userId)}`, {
            role,
          }),
        remove: (userId) =>
          this.request<void>('DELETE', `/members/${encodeURIComponent(userId)}`).then(() => {}),
      },
    };
    // Hosted ZIP export is server-authorized as a vault-admin operation; only
    // expose the capability to admins so non-admins never see an export action
    // that the server would reject.
    if (this.vault.role === 'admin') {
      this.runtime.archiveExport = {
        exportTo: (destinationPath) =>
          tauriCommands.hostedVaultExportZip(this.vault.serverUrl, this.vault.hostedVaultId, destinationPath),
      };
    }
  }

  get id() {
    return this.vault.id;
  }

  private path(suffix = '') {
    return `/api/v1/vaults/${this.vault.hostedVaultId}${suffix}`;
  }

  private request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    suffix: string,
    body?: unknown,
  ) {
    return tauriCommands.hostedVaultRequest<T>(this.vault.serverUrl, method, this.path(suffix), body);
  }

  private async manifest(): Promise<HostedManifest> {
    return this.request<HostedManifest>('GET', '/manifest');
  }

  private findByPath(manifest: HostedManifest, relativePath: string, state: HostedFileState = 'active') {
    const file = manifest.files.find((entry) => entry.relativePath === relativePath && entry.state === state);
    if (!file) throw new Error(`Hosted vault item not found: ${relativePath}`);
    return file;
  }

  private parentId(manifest: HostedManifest, parentPath: string): string | null {
    if (!parentPath) return null;
    const parent = this.findByPath(manifest, parentPath);
    if (parent.kind !== 'folder') throw new Error(`Hosted vault destination is not a folder: ${parentPath}`);
    return parent.id;
  }

  listFiles() {
    return this.request<HostedFileEntry[]>('GET', '/files').then(buildFileTree);
  }

  async buildNoteIndex(): Promise<NoteMetadata[]> {
    // Hosted vaults derive a lightweight index from the manifest. Content-derived
    // fields (wikilinks, tags, word count) are not populated here; hosted full-text
    // search is served separately by the server search endpoint.
    const entries = await this.request<HostedFileEntry[]>('GET', '/files');
    return entries
      .filter(
        (entry) =>
          entry.state === 'active' &&
          entry.kind === 'document' &&
          extension(entry.name) === 'md',
      )
      .map((entry) => ({
        relativePath: entry.relativePath,
        title: entry.name.replace(/\.md$/i, ''),
        tags: [],
        wikilinksOut: [],
        modifiedAt: timestamp(entry.updatedAt),
        wordCount: 0,
        hash: entry.currentRevision?.contentHash ?? '',
      }));
  }

  async readDocument(relativePath: string): Promise<VaultDocument> {
    const manifest = await this.manifest();
    const file = this.findByPath(manifest, relativePath);
    const document = await this.request<HostedTextDocument>('GET', `/files/${file.id}`);
    return {
      relativePath: document.file.relativePath,
      content: document.content,
      version: String(document.file.currentRevision?.sequence ?? 0),
      modifiedAt: timestamp(document.file.updatedAt),
    };
  }

  async writeDocument(
    relativePath: string,
    content: string,
    expectedVersion?: string,
    _baseContent?: string,
  ): Promise<VaultWriteResult> {
    const manifest = await this.manifest();
    const file = this.findByPath(manifest, relativePath);
    const currentSequence = file.currentRevision?.sequence ?? 0;
    const expectedSequence = expectedVersion === undefined ? currentSequence : Number(expectedVersion);
    if (!Number.isInteger(expectedSequence) || expectedSequence < 0) {
      throw new Error('Hosted document versions must be revision sequence numbers.');
    }
    const document = await this.request<HostedTextDocument>('POST', `/files/${file.id}/revisions`, {
      expectedRevisionSequence: expectedSequence,
      content,
    });
    return { version: String(document.file.currentRevision?.sequence ?? expectedSequence + 1) };
  }

  async createDocument(relativePath: string): Promise<NoteFile> {
    const manifest = await this.manifest();
    const destination = splitDestination(relativePath);
    const file = await this.request<HostedFileEntry>('POST', '/files', {
      parentId: this.parentId(manifest, destination.parentPath),
      name: destination.name,
      kind: 'document',
      documentType: documentTypeForPath(relativePath),
      content: '',
    });
    return toNoteFile(file);
  }

  async createFolder(relativePath: string): Promise<void> {
    const manifest = await this.manifest();
    const destination = splitDestination(relativePath);
    await this.request<HostedFileEntry>('POST', '/files', {
      parentId: this.parentId(manifest, destination.parentPath),
      name: destination.name,
      kind: 'folder',
      documentType: null,
      content: '',
    });
  }

  async previewRenameMove(oldPath: string, newPath: string): Promise<PathChangePreview> {
    const manifest = await this.manifest();
    const target = this.findByPath(manifest, oldPath);
    const destination = splitDestination(newPath);
    const operation = pathOperation(oldPath, newPath);
    if (operation === 'unchanged') {
      return {
        oldRelativePath: oldPath,
        newRelativePath: newPath,
        itemKind: target.kind === 'folder' ? 'folder' : 'file',
        operation,
        nestedItemCount: 0,
        affectedReferencePaths: [],
      };
    }
    // A combined change is applied as rename then move; preview the move because
    // destination-folder validation has the larger structural blast radius.
    const previewType = operation === 'move' || operation === 'move-and-rename' ? 'move' : 'rename';
    const preview = await this.request<HostedOperationPreview>('POST', '/operations/preview', {
      operationType: previewType,
      targetFileId: target.id,
      name: previewType === 'rename' ? destination.name : null,
      parentId: previewType === 'move' ? this.parentId(manifest, destination.parentPath) : null,
    });
    return {
      oldRelativePath: preview.oldRelativePath,
      newRelativePath: operation === 'move-and-rename' ? newPath : (preview.newRelativePath ?? newPath),
      itemKind: preview.itemKind === 'folder' ? 'folder' : 'file',
      operation,
      nestedItemCount: preview.nestedItemCount,
      affectedReferencePaths: preview.affectedDocuments.map((document) => document.relativePath),
      blockedReason: preview.blockedReason ?? undefined,
    };
  }

  async renameMove(oldPath: string, newPath: string, _updateReferences?: boolean): Promise<void> {
    const operation = pathOperation(oldPath, newPath);
    if (operation === 'unchanged') return;
    const destination = splitDestination(newPath);
    let currentPath = oldPath;
    if (operation === 'rename' || operation === 'move-and-rename') {
      await this.applyOperation(currentPath, 'rename', { name: destination.name });
      currentPath = [...oldPath.split('/').slice(0, -1), destination.name].filter(Boolean).join('/');
    }
    if (operation === 'move' || operation === 'move-and-rename') {
      await this.applyOperation(currentPath, 'move', { parentPath: destination.parentPath });
    }
  }

  private async applyOperation(
    relativePath: string,
    operationType: 'rename' | 'move' | 'trash' | 'restore' | 'purge',
    options: { name?: string; parentPath?: string; removeReferences?: boolean },
  ) {
    const manifest = await this.manifest();
    const target = this.findByPath(
      manifest,
      relativePath,
      operationType === 'restore' || operationType === 'purge' ? 'trashed' : 'active',
    );
    return this.request('POST', '/operations', {
      clientOperationId: crypto.randomUUID(),
      baseManifestSequence: manifest.sequence,
      operationType,
      targetFileId: target.id,
      name: options.name ?? null,
      parentId: options.parentPath === undefined ? null : this.parentId(manifest, options.parentPath),
      removeReferences: options.removeReferences ?? false,
    });
  }

  async moveToTrash(relativePath: string, removeReferences?: boolean): Promise<TrashEntry> {
    const manifest = await this.manifest();
    const target = this.findByPath(manifest, relativePath);
    await this.applyOperation(relativePath, 'trash', { removeReferences });
    return {
      id: target.id,
      originalRelativePath: target.relativePath,
      deletedAt: Date.now(),
      itemKind: target.kind === 'folder' ? 'folder' : 'file',
      extension: target.kind === 'folder' ? null : extension(target.name),
      size: target.currentRevision?.sizeBytes ?? 0,
      rootName: target.name,
    };
  }

  async deletePermanently(relativePath: string, removeReferences?: boolean): Promise<void> {
    const trashed = await this.moveToTrash(relativePath, removeReferences);
    await this.purgeTrash(trashed.id, removeReferences);
  }

  async listReferences(relativePath: string): Promise<FileReference[]> {
    const manifest = await this.manifest();
    const file = this.findByPath(manifest, relativePath);
    return this.request<HostedFileReference[]>('GET', `/files/${file.id}/references`);
  }

  async listTrash(): Promise<TrashEntry[]> {
    const manifest = await this.manifest();
    const trashedIds = new Set(
      manifest.files.filter((entry) => entry.state === 'trashed').map((entry) => entry.id),
    );
    return manifest.files
      .filter((entry) => entry.state === 'trashed' && (!entry.parentId || !trashedIds.has(entry.parentId)))
      .map((entry) => ({
        id: entry.id,
        originalRelativePath: entry.relativePath,
        deletedAt: timestamp(entry.updatedAt),
        itemKind: entry.kind === 'folder' ? 'folder' : 'file',
        extension: entry.kind === 'folder' ? null : extension(entry.name),
        size: entry.currentRevision?.sizeBytes ?? 0,
        rootName: entry.name,
      }));
  }

  async restoreTrash(entryId: string, targetRelativePath?: string): Promise<void> {
    const manifest = await this.manifest();
    const target = manifest.files.find((entry) => entry.id === entryId && entry.state === 'trashed');
    if (!target) throw new Error(`Hosted trashed item not found: ${entryId}`);
    if (targetRelativePath && targetRelativePath !== target.relativePath) {
      throw new Error('Hosted trash items currently restore to their original path.');
    }
    await this.applyOperation(target.relativePath, 'restore', {});
  }

  async purgeTrash(entryId: string, removeReferences?: boolean): Promise<void> {
    const manifest = await this.manifest();
    const target = manifest.files.find((entry) => entry.id === entryId && entry.state === 'trashed');
    if (!target) throw new Error(`Hosted trashed item not found: ${entryId}`);
    await this.applyOperation(target.relativePath, 'purge', { removeReferences });
  }

  async purgeAllTrash(): Promise<void> {
    for (const entry of await this.listTrash()) {
      await this.purgeTrash(entry.id);
    }
  }

  async search(query: string): Promise<SearchResult[]> {
    const results = await this.request<HostedSearchResult[]>('GET', `/search?q=${encodeURIComponent(query)}`);
    return results.map((result) => ({
      relativePath: result.relativePath,
      title: result.title,
      excerpt: result.excerpt,
      score: result.rank,
      matchType: 'hosted',
    }));
  }

  async createSnapshot(
    relativePath: string,
    _content: string,
    _authorId: string,
    _authorName: string,
    label?: string,
  ): Promise<SnapshotMeta> {
    // Hosted snapshots label the file's current immutable revision rather than
    // persisting caller-supplied content, so identity comes from the session.
    const manifest = await this.manifest();
    const file = this.findByPath(manifest, relativePath);
    const snapshot = await this.request<HostedSnapshot>('POST', `/files/${file.id}/snapshots`, {
      revisionId: file.currentRevision?.id ?? null,
      label: label ?? null,
    });
    return {
      id: snapshot.id,
      relativePath,
      authorId: '',
      authorName: snapshot.createdByDisplayName ?? 'Unknown user',
      timestamp: timestamp(snapshot.createdAt),
      hash: snapshot.revision.contentHash,
      label: snapshot.label ?? undefined,
    };
  }

  async listSnapshots(relativePath: string): Promise<SnapshotMeta[]> {
    const manifest = await this.manifest();
    const file = this.findByPath(manifest, relativePath);
    const snapshots = await this.request<HostedSnapshot[]>('GET', `/files/${file.id}/snapshots`);
    return snapshots.map((snapshot) => ({
      id: snapshot.id,
      relativePath,
      authorId: '',
      authorName: snapshot.createdByDisplayName ?? 'Unknown user',
      timestamp: timestamp(snapshot.createdAt),
      hash: snapshot.revision.contentHash,
      label: snapshot.label ?? undefined,
    }));
  }

  async readSnapshot(relativePath: string, snapshotId: string): Promise<string> {
    const manifest = await this.manifest();
    const file = this.findByPath(manifest, relativePath);
    const snapshots = await this.request<HostedSnapshot[]>('GET', `/files/${file.id}/snapshots`);
    const snapshot = snapshots.find((item) => item.id === snapshotId);
    if (!snapshot) throw new Error(`Hosted snapshot not found: ${snapshotId}`);
    const revision = await this.request<HostedRevisionContent>(
      'GET',
      `/files/${file.id}/revisions/${snapshot.revision.id}`,
    );
    return revision.content;
  }

  async restoreSnapshot(
    relativePath: string,
    snapshotId: string,
    _authorId: string,
    _authorName: string,
  ): Promise<VaultWriteResult> {
    const manifest = await this.manifest();
    const file = this.findByPath(manifest, relativePath);
    const document = await this.request<HostedTextDocument>(
      'POST',
      `/files/${file.id}/snapshots/${snapshotId}/restore`,
      { expectedRevisionSequence: file.currentRevision?.sequence ?? 0 },
    );
    return { version: String(document.file.currentRevision?.sequence ?? 0) };
  }

  async deleteSnapshot(_relativePath: string, _snapshotId: string): Promise<void> {
    throw new Error('Hosted snapshots are immutable and cannot be deleted.');
  }

  async clearSnapshotHistory(_relativePath: string): Promise<void> {
    throw new Error('Hosted snapshot history is immutable and cannot be cleared.');
  }

  async readAssetDataUrl(relativePath: string): Promise<string> {
    const manifest = await this.manifest();
    const file = this.findByPath(manifest, relativePath);
    if (file.kind === 'folder') throw new Error('Folders cannot be downloaded as assets.');
    return tauriCommands.hostedVaultAssetDataUrl(this.vault.serverUrl, this.vault.hostedVaultId, file.id);
  }

  async readPdfAnnotations(relativePath: string): Promise<VaultPdfAnnotations> {
    const manifest = await this.manifest();
    const file = this.findByPath(manifest, relativePath);
    const response = await this.request<{ state: Record<string, unknown>; sequence: number }>(
      'GET',
      `/files/${file.id}/pdf-annotations`,
    );
    return { state: normalizeAnnotationState(response.state), version: response.sequence };
  }

  async writePdfAnnotations(
    relativePath: string,
    state: PdfSidecarState,
    expectedVersion: number | null,
  ): Promise<VaultPdfAnnotations> {
    const manifest = await this.manifest();
    const file = this.findByPath(manifest, relativePath);
    // Only the shared annotation collections are persisted server-side; per-user
    // viewer state stays client-local and is intentionally not sent.
    const shared = {
      bookmarks: state.bookmarks,
      highlights: state.highlights,
      textAnnotations: state.textAnnotations,
      pageComments: state.pageComments,
    };
    const response = await this.request<{ state: Record<string, unknown>; sequence: number }>(
      'PUT',
      `/files/${file.id}/pdf-annotations`,
      { expectedSequence: expectedVersion ?? 0, state: shared },
    );
    return { state: normalizeAnnotationState(response.state), version: response.sequence };
  }

  /**
   * Reads a desktop file through the native client, then uploads it through the
   * authenticated server gateway with a server-verified SHA-256 digest. Returns
   * the relative path of the created hosted asset.
   */
  private async uploadExternalAsset(sourcePath: string, targetFolder = 'Pictures'): Promise<string> {
    const payload = await tauriCommands.readFileForUpload(sourcePath);
    return this.uploadAsset(payload.name, payload.mediaType, payload.contentBase64, payload.expectedHash, targetFolder);
  }

  private async uploadDataUrl(dataUrl: string, suggestedName: string, targetFolder = 'Pictures'): Promise<string> {
    const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
    if (!match) throw new Error('Only base64 data URLs can be uploaded to a hosted vault.');
    const [, mediaType, contentBase64] = match;
    const bytes = Uint8Array.from(atob(contentBase64), (char) => char.charCodeAt(0));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const expectedHash = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    return this.uploadAsset(suggestedName, mediaType, contentBase64, expectedHash, targetFolder);
  }

  private async uploadAsset(
    name: string,
    mediaType: string,
    contentBase64: string,
    expectedHash: string,
    targetFolder: string,
  ): Promise<string> {
    const parentId = targetFolder ? await this.ensureFolder(targetFolder) : null;
    const file = await this.request<HostedFileEntry>('POST', '/uploads', {
      parentId,
      name,
      mediaType,
      contentBase64,
      expectedHash,
    });
    return file.relativePath;
  }

  private async ensureFolder(relativePath: string): Promise<string> {
    const existing = (await this.manifest()).files.find(
      (entry) => entry.relativePath === relativePath && entry.kind === 'folder' && entry.state === 'active',
    );
    if (existing) return existing.id;
    await this.createFolder(relativePath);
    const created = (await this.manifest()).files.find(
      (entry) => entry.relativePath === relativePath && entry.kind === 'folder' && entry.state === 'active',
    );
    if (!created) throw new Error(`Could not create hosted folder: ${relativePath}`);
    return created.id;
  }
}

export class LocalVaultClient implements VaultClient {
  readonly kind = 'local';
  readonly capabilities = LOCAL_VAULT_CAPABILITIES;
  readonly runtime: VaultRuntimeCapabilities;

  constructor(readonly vault: LocalVaultMeta) {
    this.runtime = {
      watch: {
        start: () => tauriCommands.watchVault(this.vault.path),
        stop: () => tauriCommands.unwatchVault(),
      },
      encryption: {
        unlock: (password) => tauriCommands.unlockVault(this.vault.path, password),
        enable: (password) => tauriCommands.enableVaultEncryption(this.vault.path, password),
        disable: (password) => tauriCommands.disableVaultEncryption(this.vault.path, password),
        changePassword: (oldPassword, newPassword) =>
          tauriCommands.changeVaultPassword(this.vault.path, oldPassword, newPassword),
      },
      externalAssetImport: {
        import: (sourcePath, targetFolder) =>
          tauriCommands.importAssetIntoVault(this.vault.path, sourcePath, targetFolder),
        importData: (dataUrl, suggestedName, targetFolder = 'Pictures') =>
          tauriCommands.saveGeneratedImage(
            this.vault.path,
            `${targetFolder}/${suggestedName}`,
            dataUrl,
            false,
            suggestedName,
          ),
      },
      archiveExport: {
        exportTo: (destinationPath) => tauriCommands.exportVault(this.vault.path, destinationPath),
      },
    };
  }

  get id() {
    return this.vault.id;
  }

  listFiles() {
    return tauriCommands.listVaultFiles(this.vault.path);
  }

  buildNoteIndex() {
    return tauriCommands.buildNoteIndex(this.vault.path);
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
    return updateReferences === undefined
      ? tauriCommands.renameNote(this.vault.path, oldPath, newPath)
      : tauriCommands.renameNote(this.vault.path, oldPath, newPath, updateReferences);
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

  deletePermanently(relativePath: string, removeReferences?: boolean) {
    return tauriCommands.deleteNote(this.vault.path, relativePath, removeReferences);
  }

  listReferences(relativePath: string) {
    return tauriCommands.listFileReferences(this.vault.path, relativePath);
  }

  listTrash() {
    return tauriCommands.listTrashEntries(this.vault.path);
  }

  async restoreTrash(entryId: string, targetRelativePath?: string): Promise<void> {
    await tauriCommands.restoreTrashedItem(this.vault.path, entryId, targetRelativePath);
  }

  purgeTrash(entryId: string, removeReferences?: boolean) {
    return tauriCommands.purgeTrashedItem(this.vault.path, entryId, removeReferences);
  }

  purgeAllTrash() {
    return tauriCommands.purgeAllTrash(this.vault.path);
  }

  search(query: string) {
    return tauriCommands.searchNotes(this.vault.path, query);
  }

  createSnapshot(
    relativePath: string,
    content: string,
    authorId: string,
    authorName: string,
    label?: string,
  ) {
    return tauriCommands.createSnapshot(this.vault.path, relativePath, content, authorId, authorName, label);
  }

  listSnapshots(relativePath: string) {
    return tauriCommands.listSnapshots(this.vault.path, relativePath);
  }

  readSnapshot(relativePath: string, snapshotId: string) {
    return tauriCommands.readSnapshot(this.vault.path, relativePath, snapshotId);
  }

  async restoreSnapshot(relativePath: string, snapshotId: string, authorId: string, authorName: string): Promise<VaultWriteResult> {
    const result = await tauriCommands.restoreSnapshot(this.vault.path, relativePath, snapshotId, authorId, authorName);
    return {
      version: result.hash,
      mergedContent: result.mergedContent,
      conflict: result.conflict,
    };
  }

  deleteSnapshot(relativePath: string, snapshotId: string) {
    return tauriCommands.deleteSnapshot(this.vault.path, relativePath, snapshotId);
  }

  clearSnapshotHistory(relativePath: string) {
    return tauriCommands.clearSnapshotHistory(this.vault.path, relativePath);
  }

  readAssetDataUrl(relativePath: string) {
    return tauriCommands.readNoteAssetDataUrl(this.vault.path, relativePath);
  }

  async readPdfAnnotations(relativePath: string): Promise<VaultPdfAnnotations> {
    const state = await tauriCommands.readPdfSidecarState(this.vault.path, relativePath);
    return { state, version: null };
  }

  async writePdfAnnotations(
    relativePath: string,
    state: PdfSidecarState,
    _expectedVersion: number | null,
  ): Promise<VaultPdfAnnotations> {
    await tauriCommands.writePdfSidecarState(this.vault.path, relativePath, state);
    return { state, version: null };
  }
}

export function createVaultClient(vault: VaultMeta): VaultClient {
  return vaultKind(vault) === 'hosted'
    ? new HostedVaultClient(vault as HostedVaultMeta)
    : new LocalVaultClient(vault as LocalVaultMeta);
}

export function requireRuntimeCapability<K extends keyof VaultRuntimeCapabilities>(
  client: VaultClient,
  capability: K,
): NonNullable<VaultRuntimeCapabilities[K]> {
  const runtime = client.runtime[capability];
  if (!runtime) {
    throw new Error(`The ${capability} capability is not available for ${client.kind} vaults.`);
  }
  return runtime as NonNullable<VaultRuntimeCapabilities[K]>;
}

export function hasRuntimeCapability<K extends keyof VaultRuntimeCapabilities>(
  client: VaultClient,
  capability: K,
): client is VaultClient & { runtime: Required<Pick<VaultRuntimeCapabilities, K>> } {
  return client.runtime[capability] !== undefined;
}
