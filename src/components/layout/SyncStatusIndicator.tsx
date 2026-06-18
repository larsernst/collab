import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowUp,
  Check,
  FilePlus2,
  FolderInput,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCcw,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';

import { useVaultStore } from '../../store/vaultStore';
import { useServerStore } from '../../store/serverStore';
import { syncRollup, useSyncStore } from '../../store/syncStore';
import { onReplicaMutated, type PendingOpKind, type PendingOperation } from '../../lib/vaultReplica';
import { vaultKind, type HostedVaultMeta } from '../../types/vault';
import { cn } from '../../lib/utils';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../ui/popover';
import { Button } from '../ui/button';

const POLL_INTERVAL_MS = 5000;

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 'never';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const OP_META: Record<PendingOpKind, { label: string; Icon: typeof Pencil }> = {
  create: { label: 'Create', Icon: FilePlus2 },
  edit: { label: 'Edit', Icon: Pencil },
  rename: { label: 'Rename', Icon: Pencil },
  move: { label: 'Move', Icon: FolderInput },
  trash: { label: 'Trash', Icon: Trash2 },
  restore: { label: 'Restore', Icon: Undo2 },
  delete: { label: 'Delete', Icon: Trash2 },
  assetUpload: { label: 'Upload', Icon: Upload },
};

function opLabel(operation: PendingOperation): string {
  const path = operation.relativePath ?? operation.fileId ?? 'item';
  return path.split('/').pop() ?? path;
}

function PendingRow({ operation }: { operation: PendingOperation }) {
  const { label, Icon } = OP_META[operation.kind];
  return (
    <li className="flex items-center gap-2 px-1 py-1 text-xs">
      <Icon size={12} className="shrink-0 text-muted-foreground" />
      <span className="truncate text-foreground" title={operation.relativePath ?? undefined}>
        {opLabel(operation)}
      </span>
      <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/70">
        {operation.status === 'inflight' ? 'syncing' : label}
      </span>
    </li>
  );
}

/**
 * Live sync-status indicator for the open hosted vault. The compact status-bar
 * chip rolls up the replica's offline-sync state (synced / syncing / pending /
 * conflicts) and opens a popover with the pending-change list, a manual "Sync
 * now", and per-conflict retry/discard recovery. Hidden for local vaults.
 *
 * Stays current via a replica-mutation subscription, a focused poll, the server
 * connection status, and window focus/online events.
 */
export default function SyncStatusIndicator() {
  const vault = useVaultStore((state) => state.vault);
  const closeVault = useVaultStore((state) => state.closeVault);
  const serverStatus = useServerStore((state) => state.status);
  const { status, lastSyncedAt, pending, failed, access, isSyncing, refresh, syncNow, retry, discard, removeReplica } =
    useSyncStore();
  const clear = useSyncStore((state) => state.clear);
  const [open, setOpen] = useState(false);
  const [busyOp, setBusyOp] = useState<string | null>(null);
  const lastConflictCount = useRef(0);

  const hostedVault = vault && vaultKind(vault) === 'hosted' ? (vault as HostedVaultMeta) : null;

  const doRefresh = useCallback(() => {
    if (hostedVault) void refresh(hostedVault);
  }, [hostedVault, refresh]);

  // Refresh on vault change + clear when leaving a hosted vault.
  useEffect(() => {
    if (!hostedVault) {
      clear();
      return;
    }
    doRefresh();
  }, [hostedVault, doRefresh, clear]);

  // Refresh immediately on any replica mutation (edit queued, replay, sync).
  useEffect(() => {
    if (!hostedVault) return;
    return onReplicaMutated(doRefresh);
  }, [hostedVault, doRefresh]);

  // Re-read when the server connection status changes (offline ↔ online).
  useEffect(() => {
    if (hostedVault) doRefresh();
  }, [serverStatus, hostedVault, doRefresh]);

  // Poll while a hosted vault is open and the window is focused, plus refresh on
  // focus/online so a backgrounded window catches up promptly.
  useEffect(() => {
    if (!hostedVault) return;
    let timer: number | undefined;
    const startPolling = () => {
      if (timer !== undefined) return;
      timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') doRefresh();
      }, POLL_INTERVAL_MS);
    };
    const stopPolling = () => {
      if (timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
    };
    const onFocus = () => {
      doRefresh();
      startPolling();
    };
    startPolling();
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', doRefresh);
    window.addEventListener('blur', stopPolling);
    return () => {
      stopPolling();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', doRefresh);
      window.removeEventListener('blur', stopPolling);
    };
  }, [hostedVault, doRefresh]);

  // Toast when a new conflict appears so it's noticed with the popover closed.
  useEffect(() => {
    if (failed.length > lastConflictCount.current) {
      toast.error(
        failed.length === 1
          ? 'A sync change could not be applied and needs your attention.'
          : `${failed.length} sync changes could not be applied and need your attention.`,
      );
    }
    lastConflictCount.current = failed.length;
  }, [failed.length]);

  const rollup = useMemo(
    () => syncRollup({ isSyncing, status, pending, failed }),
    [isSyncing, status, pending, failed],
  );

  if (!hostedVault) return null;

  const accessLost = access !== 'ok';
  const accessTitle = access === 'revoked' ? 'Access revoked' : 'Vault unavailable';
  const accessMessage =
    access === 'revoked'
      ? 'Your access to this vault was revoked on the server. Your local copy and any unsynced changes are kept here until you remove them.'
      : 'This vault is no longer available on the server — it may have been deleted or archived. Your local copy and any unsynced changes are kept here until you remove them.';

  const chip = accessLost
    ? {
        className: 'text-destructive hover:text-destructive',
        icon: <AlertTriangle size={11} />,
        label: accessTitle,
      }
    : (() => {
    switch (rollup) {
      case 'conflicts':
        return {
          className: 'text-destructive hover:text-destructive',
          icon: <AlertTriangle size={11} />,
          label: `${failed.length} conflict${failed.length === 1 ? '' : 's'}`,
        };
      case 'syncing':
        return {
          className: 'text-sky-500/90 hover:text-sky-400',
          icon: <RefreshCw size={11} className="app-spin-soft" />,
          label: 'Syncing…',
        };
      case 'pending':
        return {
          className: 'text-amber-500/90 hover:text-amber-400',
          icon: <ArrowUp size={11} />,
          label: `${pending.length} pending`,
        };
      default:
        return {
          className: 'text-muted-foreground hover:text-foreground',
          icon: <Check size={11} />,
          label: 'Synced',
        };
    }
  })();

  const handleSyncNow = async () => {
    try {
      await syncNow(hostedVault);
    } catch (error) {
      toast.error(`Sync failed: ${error}`);
    }
  };

  const handleRemoveReplica = async () => {
    try {
      await removeReplica(hostedVault);
      setOpen(false);
      closeVault();
      toast.success('Removed the local copy of this vault.');
    } catch (error) {
      toast.error(`Could not remove the local copy: ${error}`);
    }
  };

  const runRecovery = async (operationId: string, action: 'retry' | 'discard') => {
    setBusyOp(operationId);
    try {
      if (action === 'retry') await retry(hostedVault, operationId);
      else await discard(hostedVault, operationId);
    } catch (error) {
      toast.error(`Could not ${action} change: ${error}`);
    } finally {
      setBusyOp(null);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'flex items-center gap-1 transition-colors app-motion-fast',
            chip.className,
          )}
          title="Offline sync status"
        >
          {chip.icon}
          <span className="text-[10px]">{chip.label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-72 p-0 text-xs">
        <div className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
          <div className="min-w-0">
            <p className="font-medium text-foreground">
              {accessLost
                ? accessTitle
                : rollup === 'conflicts'
                  ? 'Sync needs attention'
                  : rollup === 'syncing'
                    ? 'Syncing…'
                    : rollup === 'pending'
                      ? `${pending.length} change${pending.length === 1 ? '' : 's'} pending`
                      : 'Up to date'}
            </p>
            <p className="text-[10px] text-muted-foreground">last synced {timeAgo(lastSyncedAt)}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 shrink-0 gap-1 text-[11px]"
            disabled={isSyncing || accessLost}
            title={accessLost ? 'Syncing is unavailable for this vault.' : undefined}
            onClick={() => void handleSyncNow()}
          >
            {isSyncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Sync now
          </Button>
        </div>

        {accessLost && (
          <div className="border-b border-destructive/30 bg-destructive/5 px-3 py-2">
            <p className="flex items-center gap-1 text-[11px] font-medium text-destructive">
              <AlertTriangle size={12} /> {accessTitle}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">{accessMessage}</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2 h-6 gap-1 text-[10px] text-destructive hover:text-destructive"
              onClick={() => void handleRemoveReplica()}
            >
              <Trash2 size={11} /> Remove offline copy
            </Button>
          </div>
        )}

        <div className="max-h-72 overflow-y-auto px-2 py-2">
          {failed.length > 0 && (
            <div className="mb-2">
              <p className="mb-1 flex items-center gap-1 px-1 text-[10px] font-semibold uppercase tracking-widest text-destructive">
                <AlertTriangle size={11} /> Conflicts ({failed.length})
              </p>
              <ul className="flex flex-col gap-1">
                {failed.map((recovery) => (
                  <li
                    key={recovery.operation.id}
                    className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5"
                  >
                    <p className="truncate text-xs font-medium text-foreground" title={recovery.operation.relativePath ?? undefined}>
                      {OP_META[recovery.operation.kind].label} · {opLabel(recovery.operation)}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{recovery.failure.message}</p>
                    <div className="mt-1.5 flex gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 gap-1 text-[10px]"
                        disabled={busyOp === recovery.operation.id}
                        onClick={() => void runRecovery(recovery.operation.id, 'retry')}
                      >
                        <RotateCcw size={11} /> Retry
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 gap-1 text-[10px] text-muted-foreground hover:text-destructive"
                        disabled={busyOp === recovery.operation.id}
                        onClick={() => void runRecovery(recovery.operation.id, 'discard')}
                      >
                        <X size={11} /> Discard
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {pending.length > 0 ? (
            <>
              <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Pending changes ({pending.length})
              </p>
              <ul className="flex flex-col">
                {pending.map((operation) => (
                  <PendingRow key={operation.id} operation={operation} />
                ))}
              </ul>
            </>
          ) : (
            failed.length === 0 &&
            !accessLost && (
              <p className="px-1 py-3 text-center text-[11px] text-muted-foreground">
                All changes are synced.
              </p>
            )
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
