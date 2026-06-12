import { useEffect, useState } from 'react';
import { FolderOpen, Plus, Clock, ArrowRight, Server, RefreshCw, Settings, Check } from 'lucide-react';
import { AppLogo } from '../ui/AppLogo';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Separator } from '../ui/separator';
import { useVaultStore } from '../../store/vaultStore';
import { useServerStore, isEffectivelyConnected } from '../../store/serverStore';
import { useUiStore } from '../../store/uiStore';
import { tauriCommands } from '../../lib/tauri';
import { hostedVaultMeta, vaultKind } from '../../types/vault';
import { toast } from 'sonner';

export default function VaultPicker() {
  const { openVault, openHostedVault, loadRecentVaults, recentVaults, isLoading } = useVaultStore();
  const { status, hostedVaults, isLoading: isServerLoading, error, refresh, loadHostedVaults, createHostedVault } = useServerStore();
  const { openSettings } = useUiStore();
  const [creatingHosted, setCreatingHosted] = useState(false);
  const [hostedName, setHostedName] = useState('');
  const [hostedBusy, setHostedBusy] = useState(false);
  const activeHostedVaults = hostedVaults.filter((vault) => vault.status === 'active');
  const localRecentVaults = recentVaults.filter((vault) => vaultKind(vault) === 'local').slice(0, 5);
  // A connected-but-expired session cannot create vaults; only offer creation when
  // the session can actually make authenticated requests.
  const canCreateHosted = isEffectivelyConnected(status);

  useEffect(() => {
    loadRecentVaults();
    refresh().catch(() => {});
  }, []);

  const openHosted = async (vaultId: string) => {
    if (!status?.serverUrl) return;
    const hosted = hostedVaults.find((vault) => vault.id === vaultId);
    if (!hosted) return;
    try {
      await openHostedVault(hostedVaultMeta(status.serverUrl, hosted));
    } catch (reason) {
      toast.error(`Failed to open hosted vault: ${reason}`);
    }
  };

  const handleCreateHosted = async () => {
    const name = hostedName.trim();
    if (!name || !status?.serverUrl) return;
    setHostedBusy(true);
    try {
      const created = await createHostedVault(name);
      setHostedName('');
      setCreatingHosted(false);
      await openHostedVault(hostedVaultMeta(status.serverUrl, created));
    } catch (reason) {
      toast.error(`Failed to create hosted vault: ${reason}`);
    } finally {
      setHostedBusy(false);
    }
  };

  const openServerSettings = () => {
    openSettings();
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('settings:open-tab', { detail: { tab: 'server' } }));
    });
  };

  const handleOpenDialog = async () => {
    try {
      const path = await tauriCommands.showOpenVaultDialog();
      if (path) await openVault(path);
    } catch (e) {
      toast.error('Failed to open vault: ' + e);
    }
  };

  const handleCreateVault = async () => {
    try {
      const path = await tauriCommands.showOpenVaultDialog();
      if (!path) return;
      const name = prompt('Vault name:', 'My Vault');
      if (!name) return;
      // Read identity from localStorage — collabStore initialises these on first run
      const userId = localStorage.getItem('collab-user-id') ?? undefined;
      const userName = localStorage.getItem('collab-user-name') ?? undefined;
      await tauriCommands.createVault(path, name, userId, userName);
      await openVault(path);
    } catch (e) {
      toast.error('Failed to create vault: ' + e);
    }
  };

  return (
    <div className="vault-bg flex h-screen items-center justify-center overflow-hidden">
      {/* Ambient glow orbs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full bg-primary/8 blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[300px] rounded-full bg-blue-500/6 blur-[100px]" />
      </div>

      <div className="relative w-full max-w-2xl px-4">
        {/* Logo block */}
        <div className="text-center mb-8 app-fade-slide-in">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/15 border border-primary/20 mb-4 glow-primary-sm app-fade-scale-in">
            <AppLogo size={28} className="text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">collab</h1>
          <p className="text-sm text-muted-foreground mt-1.5">Your collaborative knowledge base</p>
        </div>

        {/* Glass card */}
        <div className="glass rounded-xl p-5 shadow-2xl app-fade-scale-in">
          <div className="flex flex-col gap-2.5">
            <Button
              onClick={handleOpenDialog}
              disabled={isLoading}
              className="h-11 gap-2 text-sm font-medium bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 transition-all app-motion-base"
            >
              <FolderOpen size={16} />
              Open Existing Vault
            </Button>
            <Button
              onClick={handleCreateVault}
              variant="outline"
              disabled={isLoading}
              className="h-11 gap-2 text-sm font-medium border-border/60 bg-white/4 hover:bg-white/8 transition-all app-motion-base"
            >
              <Plus size={16} />
              Create New Vault
            </Button>
          </div>

          <div className="flex items-center gap-2 mt-5 mb-3">
            <Separator className="flex-1 bg-border/40" />
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground uppercase tracking-widest shrink-0">
              <Server size={10} />
              Hosted
            </span>
            <Separator className="flex-1 bg-border/40" />
          </div>

          {status?.connected && status.serverUrl ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-card/30 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{status.user?.displayName}</p>
                  <p className="truncate text-[10px] text-muted-foreground">{status.serverUrl}</p>
                </div>
                <div className="flex items-center gap-1">
                  {canCreateHosted && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      onClick={() => setCreatingHosted((value) => !value)}
                      title="New hosted vault"
                    >
                      <Plus size={13} />
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    disabled={isServerLoading}
                    onClick={() => loadHostedVaults().catch((reason) => toast.error(String(reason)))}
                    title="Refresh hosted vaults"
                  >
                    <RefreshCw size={12} className={isServerLoading ? 'animate-spin' : undefined} />
                  </Button>
                </div>
              </div>
              {creatingHosted && canCreateHosted && (
                <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-card/30 px-2 py-2">
                  <Input
                    autoFocus
                    value={hostedName}
                    onChange={(e) => setHostedName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateHosted();
                      if (e.key === 'Escape') { setCreatingHosted(false); setHostedName(''); }
                    }}
                    placeholder="New hosted vault name"
                    className="h-7 text-sm"
                  />
                  <Button size="sm" className="h-7 gap-1 text-xs" disabled={hostedBusy || !hostedName.trim()} onClick={handleCreateHosted}>
                    <Check size={12} />
                    {hostedBusy ? 'Creating…' : 'Create'}
                  </Button>
                </div>
              )}
              {activeHostedVaults.map((vault) => (
                <button
                  key={vault.id}
                  onClick={() => openHosted(vault.id)}
                  disabled={isLoading || isServerLoading}
                  className="group flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-all app-motion-base hover:border-primary/25 hover:bg-primary/5"
                >
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10">
                    <Server size={12} className="text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">{vault.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {vault.role} · {vault.members} members · {vault.ownerDisplayName}
                    </div>
                  </div>
                  <ArrowRight size={13} className="shrink-0 text-muted-foreground opacity-0 transition-all app-motion-base group-hover:translate-x-0.5 group-hover:opacity-60" />
                </button>
              ))}
              {!isServerLoading && activeHostedVaults.length === 0 && (
                <p className="py-2 text-center text-xs text-muted-foreground">No active hosted vaults are available.</p>
              )}
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          ) : (
            <button
              onClick={openServerSettings}
              className="flex w-full items-center gap-3 rounded-lg border border-dashed border-border/60 px-3 py-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/5"
            >
              <Settings size={14} className="text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Connect a Collab server</p>
                <p className="text-[11px] text-muted-foreground">Sign in from Settings to open hosted vaults.</p>
              </div>
            </button>
          )}

          {localRecentVaults.length > 0 && (
            <>
              <div className="flex items-center gap-2 mt-5 mb-3">
                <Separator className="flex-1 bg-border/40" />
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground uppercase tracking-widest shrink-0">
                  <Clock size={10} />
                  Recent
                </span>
                <Separator className="flex-1 bg-border/40" />
              </div>

              <div className="space-y-1">
                {localRecentVaults.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => openVault(v.path)}
                    disabled={isLoading}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-transparent hover:border-border/50 hover:bg-white/5 text-left transition-all app-motion-base group"
                  >
                    <div className="w-7 h-7 rounded-md bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
                      <div className="w-2 h-2 rounded-sm bg-primary/70" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{v.name}</div>
                      <div className="text-[11px] text-muted-foreground truncate opacity-70">{v.path}</div>
                    </div>
                    <ArrowRight
                      size={13}
                      className="text-muted-foreground opacity-0 group-hover:opacity-60 group-hover:translate-x-0.5 transition-all app-motion-base shrink-0"
                    />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <p className="text-center text-[11px] text-muted-foreground/40 mt-4">
          Local-first vaults · Optional hosted collaboration
        </p>
      </div>
    </div>
  );
}
