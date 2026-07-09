import {
  File as FileIcon,
  FileText,
  Folder,
  Image as ImageIcon,
  KanbanSquare,
  Loader2,
  Shapes,
} from 'lucide-react';
import type { ReactNode } from 'react';

import type { MemberRole } from '../mobileTauri';
import { ROLE_LABEL, type FileGlyph } from '../lib/format';

export function Spinner({ size = 18 }: { size?: number }) {
  return <Loader2 className="spin" size={size} aria-hidden />;
}

export function RoleBadge({ role }: { role: MemberRole }) {
  return <span className={`role-badge role-${role}`}>{ROLE_LABEL[role]}</span>;
}

export function ReadOnlyBadge() {
  return <span className="readonly-badge">Read only</span>;
}

export function StatusDot({ online }: { online: boolean }) {
  return <span className={`status-dot ${online ? 'online' : 'offline'}`} aria-hidden />;
}

export function EmptyState({
  icon,
  title,
  message,
}: {
  icon: ReactNode;
  title: string;
  message: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  );
}

export function Banner({ tone, children }: { tone: 'error' | 'info'; children: ReactNode }) {
  return <div className={`banner banner-${tone}`}>{children}</div>;
}

export function GlyphIcon({ glyph, size = 20 }: { glyph: FileGlyph; size?: number }) {
  switch (glyph) {
    case 'folder':
      return <Folder size={size} aria-hidden />;
    case 'note':
      return <FileText size={size} aria-hidden />;
    case 'kanban':
      return <KanbanSquare size={size} aria-hidden />;
    case 'canvas':
      return <Shapes size={size} aria-hidden />;
    case 'image':
      return <ImageIcon size={size} aria-hidden />;
    case 'pdf':
      return <FileText size={size} aria-hidden />;
    default:
      return <FileIcon size={size} aria-hidden />;
  }
}
