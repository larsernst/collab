import { Eye } from 'lucide-react';

/**
 * Slim read-only notice shown at the top of document editors when the open
 * hosted vault grants the current user only viewer access. Communicates why
 * editing is disabled so a viewer is never surprised by a silently inert editor
 * or a failed save.
 */
export function ReadOnlyBanner({ className }: { className?: string }) {
  return (
    <div
      className={
        'flex items-center gap-2 border-b border-border/50 bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground select-none' +
        (className ? ' ' + className : '')
      }
      role="status"
    >
      <Eye size={12} className="shrink-0 opacity-70" />
      <span>Read-only — you have viewer access to this hosted vault.</span>
    </div>
  );
}
