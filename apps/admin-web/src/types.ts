export type UserRole = 'member' | 'admin';
export type UserStatus = 'active' | 'disabled';

export interface ServerUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  lastLoginAt: string | null;
  activeSessions: number;
  isPrimaryAdmin: boolean;
}

export interface AuditEvent {
  id: string;
  actorDisplayName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  result: string;
  createdAt: string;
}

export interface AdminOverview {
  health: 'ok' | 'degraded';
  serverVersion: string;
  protocolVersion: number;
  uptimeSeconds: number;
  users: number;
  activeUsers: number;
  activeSessions: number;
  pendingInvitations: number;
  hostedVaults: number;
  storage: {
    databaseBytes: number;
    blobBytes: number;
  };
  operationalWarnings: OperationalWarning[];
  recentAuditEvents: AuditEvent[];
}

export interface OperationalWarning {
  code: string;
  message: string;
  severity: string;
}

export interface Invitation {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

export interface CreatedInvitation {
  invitation: Invitation;
  token: string;
}

export type HostedVaultStatus = 'active' | 'archived' | 'pending_delete';
export type HostedVaultRole = 'viewer' | 'editor' | 'admin';

export interface HostedVaultSummary {
  id: string;
  name: string;
  ownerDisplayName: string;
  status: HostedVaultStatus;
  members: number;
  storageBytes: number;
  updatedAt: string;
}

export interface HostedVaultAdminDetail {
  id: string;
  name: string;
  ownerUserId: string;
  ownerUsername: string;
  ownerDisplayName: string;
  status: HostedVaultStatus;
  manifestSequence: number;
  members: number;
  activeFiles: number;
  trashedFiles: number;
  storageBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface HostedVaultMember {
  userId: string;
  username: string;
  displayName: string;
  role: HostedVaultRole;
  owner: boolean;
  createdAt: string;
}

export interface HostedVaultActivityEvent {
  id: string;
  actorDisplayName: string | null;
  eventType: string;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
}

export interface HostedVaultStorage {
  activeBytes: number;
  trashBytes: number;
  retainedRevisionBytes: number;
  uniqueBlobBytes: number;
  activeFiles: number;
  trashedFiles: number;
  revisionCount: number;
  snapshotCount: number;
}

export interface HostedVaultImportResult {
  importedFiles: number;
  importedFolders: number;
  importedBytes: number;
  resultManifestSequence: number;
}
