import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { tauriCommands, type ServerConnectionStatus } from '../../lib/tauri';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { SectionLabel } from './settingsControls';

const SERVER_URL_KEY = 'collab-hosted-server-url';

export default function SettingsServerSection() {
  const [serverUrl, setServerUrl] = useState(() => localStorage.getItem(SERVER_URL_KEY) ?? '');
  const [status, setStatus] = useState<ServerConnectionStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    tauriCommands.serverConnectionStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const next = await tauriCommands.connectServer(serverUrl, String(form.get('username')), String(form.get('password')));
      localStorage.setItem(SERVER_URL_KEY, serverUrl);
      setStatus(next);
      toast.success('Connected to Collab server');
    } catch (reason) {
      toast.error(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function reconnect() {
    setBusy(true);
    try {
      const next = await tauriCommands.reconnectServer(serverUrl);
      setStatus(next);
      toast.success('Server session restored');
    } catch (reason) {
      toast.error(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    await tauriCommands.disconnectServer();
    setStatus({ connected: false, serverUrl: null, user: null, accessExpiresAt: null });
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
          <Button size="sm" variant="outline" onClick={disconnect}>Disconnect</Button>
        </div>
      ) : (
        <form className="space-y-3" onSubmit={connect}>
          <label className="block space-y-1"><span className="text-xs font-medium">Server URL</span><Input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="https://collab.example.com" required /></label>
          <label className="block space-y-1"><span className="text-xs font-medium">Username</span><Input name="username" autoComplete="username" required /></label>
          <label className="block space-y-1"><span className="text-xs font-medium">Password</span><Input name="password" type="password" autoComplete="current-password" required /></label>
          <div className="flex gap-2"><Button size="sm" disabled={busy}>Connect</Button><Button size="sm" type="button" variant="outline" disabled={busy || !serverUrl} onClick={reconnect}>Restore saved session</Button></div>
        </form>
      )}
    </div>
  );
}
