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
  serverVersion: string;
  protocolVersion: number;
  uptimeSeconds: number;
  users: number;
  activeUsers: number;
  activeSessions: number;
  pendingInvitations: number;
  hostedVaults: number;
  recentAuditEvents: AuditEvent[];
}
