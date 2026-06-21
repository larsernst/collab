import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useServerStore } from '../../store/serverStore';
import { Button } from '../ui/button';
import { HostedLoginForm } from '../server/HostedLoginForm';
import { SectionLabel } from './settingsControls';

const ALWAYS_CREATE_OFFLINE_COPY_KEY = 'collab-hosted-always-create-offline-copy';

export default function SettingsServerSection() {
  const { status, refresh, disconnect: disconnectServer } = useServerStore();
  const [alwaysCreateOfflineCopy, setAlwaysCreateOfflineCopy] = useState(
    () => localStorage.getItem(ALWAYS_CREATE_OFFLINE_COPY_KEY) === 'true',
  );

  useEffect(() => {
    refresh().catch(() => {});
  }, []);

  async function disconnect() {
    await disconnectServer();
    toast.success('Disconnected from server');
  }

  function toggleAlwaysCreateOfflineCopy() {
    const next = !alwaysCreateOfflineCopy;
    setAlwaysCreateOfflineCopy(next);
    localStorage.setItem(ALWAYS_CREATE_OFFLINE_COPY_KEY, String(next));
    toast.success(next ? 'Hosted vaults will be cached for offline use when opened.' : 'Automatic offline-copy creation disabled.');
  }

  return (
    <div className="space-y-5">
      <div>
        <SectionLabel>Hosted server</SectionLabel>
        <p className="text-sm text-muted-foreground">
          Connect this desktop app to a Collab server. The refresh token is stored only in your operating system credential store.
        </p>
      </div>
      {status?.connected ? (
        <div className="space-y-3 rounded-lg border border-border/50 bg-card/40 p-4">
          <div><p className="text-sm font-medium">{status.user?.displayName}</p><p className="text-xs text-muted-foreground">{status.user?.username} on {status.serverUrl}</p></div>
          {status.allowInvalidCertificates && <p className="text-xs text-destructive">TLS certificate verification is disabled for this connection.</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={alwaysCreateOfflineCopy ? 'default' : 'outline'} onClick={toggleAlwaysCreateOfflineCopy}>
              {alwaysCreateOfflineCopy ? 'Always create offline copy: On' : 'Always create offline copy'}
            </Button>
            <Button size="sm" variant="outline" onClick={disconnect}>Disconnect</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            When enabled, opening a hosted vault downloads active documents and assets into the local replica automatically.
          </p>
        </div>
      ) : (
        <HostedLoginForm />
      )}
    </div>
  );
}
