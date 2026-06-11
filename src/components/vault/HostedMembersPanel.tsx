import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

import { createVaultClient, type VaultMembersCapability } from '../../lib/vaultClient';
import { useVaultStore } from '../../store/vaultStore';
import { vaultKind, type HostedVaultMeta, type HostedVaultMember, type MemberRole, type UserDirectoryEntry } from '../../types/vault';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';

const ROLE_OPTIONS: { value: MemberRole; label: string; hint: string }[] = [
  { value: 'viewer', label: 'Viewer', hint: 'Read-only access' },
  { value: 'editor', label: 'Editor', hint: 'Read and write content' },
  { value: 'admin', label: 'Admin', hint: 'Manage content and members' },
];

function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function RoleSelect({
  value,
  disabled,
  onChange,
}: {
  value: MemberRole;
  disabled?: boolean;
  onChange: (role: MemberRole) => void;
}) {
  return (
    <Select value={value} disabled={disabled} onValueChange={(next) => onChange(next as MemberRole)}>
      <SelectTrigger className="h-8 w-28 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLE_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value} className="text-xs">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function HostedMembersPanel() {
  const vault = useVaultStore((state) => state.vault);
  const members = useMemo<VaultMembersCapability | null>(
    () => (vault && vaultKind(vault) === 'hosted' ? createVaultClient(vault).runtime.members ?? null : null),
    [vault],
  );
  const myRole = vault && vaultKind(vault) === 'hosted' ? (vault as HostedVaultMeta).role : 'viewer';
  const canManage = myRole === 'admin';

  const [list, setList] = useState<HostedVaultMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserDirectoryEntry[]>([]);
  const [selected, setSelected] = useState<UserDirectoryEntry | null>(null);
  const [addRole, setAddRole] = useState<MemberRole>('editor');
  const [adding, setAdding] = useState(false);

  const refresh = useCallback(async () => {
    if (!members) return;
    try {
      setError(null);
      setList(await members.list());
    } catch (e) {
      setError(String(e));
    }
  }, [members]);

  useEffect(() => {
    setList(null);
    void refresh();
  }, [refresh]);

  // Debounced directory search for the add-member typeahead.
  useEffect(() => {
    if (!canManage || !members) return;
    const term = query.trim();
    if (!term) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      members
        .searchDirectory(term)
        .then((entries) => {
          if (!cancelled) setResults(entries);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query, canManage, members]);

  const memberIds = useMemo(() => new Set((list ?? []).map((member) => member.userId)), [list]);

  const handleAdd = async () => {
    if (!members || !selected) return;
    setAdding(true);
    try {
      await members.add(selected.userId, addRole);
      toast.success(`Added ${selected.displayName}`);
      setSelected(null);
      setQuery('');
      setResults([]);
      await refresh();
    } catch (e) {
      toast.error(`Failed to add member: ${e}`);
    } finally {
      setAdding(false);
    }
  };

  const handleRoleChange = async (member: HostedVaultMember, role: MemberRole) => {
    if (!members || role === member.role) return;
    setBusyUserId(member.userId);
    try {
      await members.updateRole(member.userId, role);
      await refresh();
    } catch (e) {
      toast.error(`Failed to update role: ${e}`);
    } finally {
      setBusyUserId(null);
    }
  };

  const handleRemove = async (member: HostedVaultMember) => {
    if (!members) return;
    setBusyUserId(member.userId);
    try {
      await members.remove(member.userId);
      toast.success(`Removed ${member.displayName}`);
      await refresh();
    } catch (e) {
      toast.error(`Failed to remove member: ${e}`);
    } finally {
      setBusyUserId(null);
    }
  };

  if (!members) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Connect to the hosted vault server to manage members.
      </div>
    );
  }

  return (
    <div className="flex h-full max-w-[36rem] flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="flex size-8 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
          <ShieldCheck size={15} className="text-primary" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-foreground">Members</h3>
          <p className="text-xs text-muted-foreground">
            Roles are authoritative on the connected server.
            {!canManage && ' You need an admin role to make changes.'}
          </p>
        </div>
      </div>

      {canManage && (
        <div className="rounded-lg border border-border/50 p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Add member
          </p>
          <div className="relative">
            <Input
              value={selected ? `${selected.displayName} (@${selected.username})` : query}
              onChange={(e) => {
                setSelected(null);
                setQuery(e.target.value);
              }}
              placeholder="Search users by name or username…"
              className="h-8 text-sm"
            />
            {!selected && results.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-border/60 bg-popover shadow-lg">
                {results.map((entry) => {
                  const alreadyMember = memberIds.has(entry.userId);
                  return (
                    <li key={entry.userId}>
                      <button
                        type="button"
                        disabled={alreadyMember}
                        onClick={() => {
                          setSelected(entry);
                          setResults([]);
                        }}
                        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent/60 disabled:opacity-50"
                      >
                        <span className="truncate">
                          {entry.displayName} <span className="text-muted-foreground">@{entry.username}</span>
                        </span>
                        {alreadyMember && <span className="text-[10px] text-muted-foreground">member</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <RoleSelect value={addRole} onChange={setAddRole} />
            <Button size="sm" className="h-8 gap-1.5" disabled={!selected || adding} onClick={() => void handleAdd()}>
              {adding ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
              Add
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {list === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> Loading members…
          </div>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">No members yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {list.map((member) => (
              <li
                key={member.userId}
                className="flex items-center gap-3 rounded-md border border-border/40 px-3 py-2"
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/60 text-[11px] font-semibold">
                  {initials(member.displayName)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{member.displayName}</p>
                  <p className="truncate text-xs text-muted-foreground">@{member.username}</p>
                </div>
                {member.owner ? (
                  <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                    Owner
                  </span>
                ) : (
                  <>
                    <RoleSelect
                      value={member.role}
                      disabled={!canManage || busyUserId === member.userId}
                      onChange={(role) => void handleRoleChange(member, role)}
                    />
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-destructive"
                        disabled={busyUserId === member.userId}
                        onClick={() => void handleRemove(member)}
                        aria-label={`Remove ${member.displayName}`}
                      >
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
