import { useEffect } from 'react';
import { toast } from 'sonner';
import { useServerStore } from '../../store/serverStore';
import { Button } from '../ui/button';
import { HostedLoginForm } from '../server/HostedLoginForm';
import { SectionLabel } from './settingsControls';

export default function SettingsServerSection() {
  const { status, refresh, disconnect: disconnectServer } = useServerStore();

  useEffect(() => {
    refresh().catch(() => {});
  }, []);

  async function disconnect() {
    await disconnectServer();
    toast.success('Disconnected from server');
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
          <Button size="sm" variant="outline" onClick={disconnect}>Disconnect</Button>
        </div>
      ) : (
        <HostedLoginForm />
      )}
    </div>
  );
}
