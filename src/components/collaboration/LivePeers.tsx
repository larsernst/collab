import { dedupePeersByUser, type LivePeer } from '../../lib/liveAwareness';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

/**
 * Consistent live co-editor indicator for hosted document views (note, Kanban,
 * canvas). Renders one avatar per peer currently subscribed to the same live
 * document, deduped by user so multiple tabs collapse into one. Distinct from
 * the coarse `PresenceBar` (filesystem presence) by the pulsing "live" dot.
 */
export default function LivePeers({ peers, max = 5 }: { peers: LivePeer[]; max?: number }) {
  const users = dedupePeersByUser(peers);
  if (users.length === 0) return null;

  return (
    <div className="flex items-center gap-1" data-testid="live-peers">
      <span
        className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0 app-status-breathe"
        aria-hidden
      />
      {users.slice(0, max).map((peer) => (
        <Tooltip key={peer.clientId}>
          <TooltipTrigger>
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 app-fade-scale-in"
              style={{ backgroundColor: peer.user?.color }}
            >
              {(peer.user?.name ?? '?').charAt(0).toUpperCase()}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>{peer.user?.name}</p>
            <p className="text-xs opacity-70">editing live</p>
          </TooltipContent>
        </Tooltip>
      ))}
      {users.length > max && (
        <span className="text-xs text-muted-foreground">+{users.length - max}</span>
      )}
    </div>
  );
}
