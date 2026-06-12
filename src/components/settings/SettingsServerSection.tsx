import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useServerStore } from '../../store/serverStore';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { SectionLabel } from './settingsControls';

const SERVER_URL_KEY = 'collab-hosted-server-url';
const USERNAME_KEY = 'collab-hosted-username';
const ALLOW_INVALID_CERTIFICATES_KEY = 'collab-hosted-allow-invalid-certificates';

export default function SettingsServerSection() {
  const [serverUrl, setServerUrl] = useState(() => localStorage.getItem(SERVER_URL_KEY) ?? '');
  const [username, setUsername] = useState(() => localStorage.getItem(USERNAME_KEY) ?? '');
  const [allowInvalidCertificates, setAllowInvalidCertificates] = useState(
    () => localStorage.getItem(ALLOW_INVALID_CERTIFICATES_KEY) === 'true',
  );
  const { status, isLoading: busy, refresh, connect: connectServer, reconnect: reconnectServer, disconnect: disconnectServer } = useServerStore();

  useEffect(() => {
    refresh().catch(() => {});
  }, []);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    // Persist the server URL and username up front so a disrupted or failed login
    // (wrong password, network error) does not lose what the user already typed.
    localStorage.setItem(SERVER_URL_KEY, serverUrl);
    localStorage.setItem(USERNAME_KEY, username);
    localStorage.setItem(ALLOW_INVALID_CERTIFICATES_KEY, String(allowInvalidCertificates));
    try {
      await connectServer(serverUrl, username, String(form.get('password')), allowInvalidCertificates);
      toast.success('Connected to Collab server');
    } catch (reason) {
      toast.error(String(reason));
    }
  }

  async function reconnect() {
    try {
      await reconnectServer(serverUrl, allowInvalidCertificates);
      toast.success('Server session restored');
    } catch (reason) {
      toast.error(String(reason));
    } finally {
    }
  }

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
        <form className="space-y-3" onSubmit={connect}>
          <label className="block space-y-1"><span className="text-xs font-medium">Server URL</span><Input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="https://collab.example.com" required /></label>
          <label className="block space-y-1"><span className="text-xs font-medium">Username</span><Input name="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /></label>
          <label className="block space-y-1"><span className="text-xs font-medium">Password</span><Input name="password" type="password" autoComplete="current-password" required /></label>
          <label className="flex items-start gap-2 rounded-lg border border-border/50 bg-card/30 p-3">
            <Checkbox
              aria-label="Allow untrusted TLS certificates"
              checked={allowInvalidCertificates}
              onCheckedChange={(checked) => setAllowInvalidCertificates(checked === true)}
            />
            <span>
              <span className="block text-xs font-medium">Allow untrusted TLS certificates</span>
              <span className="mt-1 block text-[11px] text-muted-foreground">
                For private servers using a self-signed certificate. This disables certificate verification for this server connection.
              </span>
            </span>
          </label>
          <div className="flex gap-2"><Button size="sm" disabled={busy}>Connect</Button><Button size="sm" type="button" variant="outline" disabled={busy || !serverUrl} onClick={reconnect}>Restore saved session</Button></div>
        </form>
      )}
    </div>
  );
}
