import * as Y from 'yjs';
import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import { tauriCommands } from './tauri';
import type { VaultClient } from './vaultClient';

/**
 * Live collaboration transport for hosted documents.
 *
 * Speaks the Phase 5 server protocol (see `crates/collab-server/src/ws.rs`):
 * JSON control frames for `authenticate`/`ready`/`document.subscribe` and binary
 * `[tag][fileId][yjs-v1-payload]` frames for the CRDT sync handshake. The shared
 * document is a standard `Y.Doc`, so it binds directly to CodeMirror through
 * `y-codemirror.next`.
 *
 * A session only opens when the initial connect+authenticate+subscribe succeeds,
 * so callers can fall back to the REST optimistic-write path when live
 * collaboration is unavailable (local vaults, self-signed servers the webview
 * cannot reach, or a server that is offline). Once live, brief disconnections
 * are recovered by reconnecting and re-running the sync handshake rather than
 * dropping back to REST mid-edit.
 */

const SYNC_STEP1 = 1;
const SYNC_UPDATE = 2;
const AWARENESS = 3;
const HEADER_LEN = 1 + 16;
/**
 * Live-collaboration wire protocol version this client speaks. Sent in the
 * `authenticate` frame and checked against the server's advertised version in
 * `ready`. Must stay in sync with `collab_protocol::PROTOCOL_VERSION`.
 */
const PROTOCOL_VERSION = 1;
/** Server error code (snake_case `ErrorCode`) for an unsupported wire version. */
const PROTOCOL_VERSION_UNSUPPORTED = 'protocol_version_unsupported';
const NOTE_TEXT_NAME = 'content';
const CONNECT_TIMEOUT_MS = 8000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

export type LiveStatus = 'connecting' | 'connected' | 'disconnected';

/** Connection target resolved from a {@link VaultClient}. */
export interface LiveTarget {
  serverUrl: string;
  vaultId: string;
  fileId: string;
}

/** Generic live document handle shared by note (text) and structured sessions. */
export interface LiveDocumentHandle {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  getStatus(): LiveStatus;
  onStatus(cb: (status: LiveStatus) => void): () => void;
  destroy(): void;
}

export interface LiveDocumentSession extends LiveDocumentHandle {
  readonly text: Y.Text;
}

/** Origin tag for updates applied from the network, so they are not re-sent. */
const REMOTE_ORIGIN = Symbol('live-remote');
const REMOTE_AWARENESS_ORIGIN = Symbol('live-awareness-remote');

function encodeFileId(fileId: string): Uint8Array {
  // Hosted file ids are UUID strings; encode the 16 raw bytes into the header.
  const hex = fileId.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function frame(tag: number, fileIdBytes: Uint8Array, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(HEADER_LEN + payload.length);
  out[0] = tag;
  out.set(fileIdBytes, 1);
  out.set(payload, HEADER_LEN);
  return out;
}

export class WebSocketYProvider {
  readonly doc = new Y.Doc();
  readonly awareness = new Awareness(this.doc);

  private socket: WebSocket | null = null;
  private status: LiveStatus = 'connecting';
  private statusCallbacks = new Set<(status: LiveStatus) => void>();
  private readonly fileIdBytes: Uint8Array;
  private destroyed = false;
  // A non-recoverable failure (e.g. the server speaks an incompatible protocol
  // version). Unlike a transient drop or an expired single-use ticket, retrying
  // cannot help, so reconnection is suppressed and the caller falls back to REST.
  private fatal = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private initialSyncPending = false;
  private subscribedCallback: ((ok: boolean) => void) | undefined;

  constructor(private readonly target: LiveTarget) {
    this.fileIdBytes = encodeFileId(target.fileId);
    this.doc.on('update', this.handleLocalUpdate);
    this.awareness.on('update', this.handleAwarenessUpdate);
  }

  /** Generic handle without document-shape-specific accessors. */
  handle(): LiveDocumentHandle {
    return {
      doc: this.doc,
      awareness: this.awareness,
      getStatus: () => this.getStatus(),
      onStatus: (cb) => this.onStatus(cb),
      destroy: () => this.destroy(),
    };
  }

  private handleLocalUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE_ORIGIN) return;
    this.sendBinary(SYNC_UPDATE, update);
  };

  private handleAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === REMOTE_AWARENESS_ORIGIN) return;
    const clients = [...changes.added, ...changes.updated, ...changes.removed];
    if (clients.length > 0) {
      this.sendBinary(AWARENESS, encodeAwarenessUpdate(this.awareness, clients));
    }
  };

  private sendLocalAwareness() {
    if (this.awareness.getLocalState() !== null) {
      this.sendBinary(AWARENESS, encodeAwarenessUpdate(this.awareness, [this.doc.clientID]));
    }
  }

  private sendBinary(tag: number, payload: Uint8Array) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(frame(tag, this.fileIdBytes, payload));
    }
  }

  private setStatus(status: LiveStatus) {
    if (this.status === status) return;
    this.status = status;
    for (const cb of this.statusCallbacks) cb(status);
  }

  getStatus() {
    return this.status;
  }

  onStatus(cb: (status: LiveStatus) => void) {
    this.statusCallbacks.add(cb);
    return () => this.statusCallbacks.delete(cb);
  }

  /**
   * Opens the socket and resolves once the document subscription is confirmed
   * (live), or `false` if the connection fails before that point. Used for the
   * initial live-vs-REST decision.
   */
  connectOnce(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      const timeout = setTimeout(() => finish(false), CONNECT_TIMEOUT_MS);
      void this.openSocket((ok) => {
        clearTimeout(timeout);
        finish(ok);
      });
    });
  }

  private async openSocket(onSubscribed?: (ok: boolean) => void) {
    if (this.destroyed) {
      onSubscribed?.(false);
      return;
    }
    this.setStatus(this.reconnectAttempts === 0 ? 'connecting' : 'connecting');
    let ticket: { ticket: string; websocketUrl: string };
    try {
      ticket = await tauriCommands.hostedWsTicket(this.target.serverUrl, this.target.vaultId);
    } catch {
      onSubscribed?.(false);
      this.scheduleReconnect();
      return;
    }
    if (this.destroyed) {
      onSubscribed?.(false);
      return;
    }

    let socket: WebSocket;
    try {
      socket = new WebSocket(ticket.websocketUrl);
    } catch {
      onSubscribed?.(false);
      this.scheduleReconnect();
      return;
    }
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    this.subscribedCallback = onSubscribed;
    this.initialSyncPending = false;

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          type: 'authenticate',
          ticket: ticket.ticket,
          protocolVersion: PROTOCOL_VERSION,
        }),
      );
    };
    socket.onmessage = (event) => this.handleMessage(event, onSubscribed);
    socket.onerror = () => {
      // `onclose` follows and handles reconnect.
    };
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      onSubscribed?.(false);
      if (!this.destroyed) {
        this.setStatus('disconnected');
        this.scheduleReconnect();
      }
    };
  }

  private handleMessage(event: MessageEvent, onSubscribed?: (ok: boolean) => void) {
    if (typeof event.data === 'string') {
      let control: { type?: string; protocolVersion?: number; code?: string };
      try {
        control = JSON.parse(event.data);
      } catch {
        return;
      }
      switch (control.type) {
        case 'ready':
          // Protocol negotiation: the server echoes the version it accepted. A
          // mismatch is unrecoverable, so do not subscribe and stop retrying.
          if (
            typeof control.protocolVersion === 'number' &&
            control.protocolVersion !== PROTOCOL_VERSION
          ) {
            this.failFatally(onSubscribed);
            break;
          }
          this.socket?.send(
            JSON.stringify({ type: 'document.subscribe', fileId: this.target.fileId }),
          );
          break;
        case 'document.subscribed':
          this.reconnectAttempts = 0;
          // Pull anything the server has that we are missing.
          this.initialSyncPending = true;
          this.sendBinary(SYNC_STEP1, Y.encodeStateVector(this.doc));
          this.sendLocalAwareness();
          break;
        case 'error':
          if (control.code === PROTOCOL_VERSION_UNSUPPORTED) {
            // The server rejected our wire version: retrying cannot help.
            this.failFatally(onSubscribed);
          } else {
            // Other authentication/authorization failures may be transient (an
            // expired single-use ticket reconnects with a fresh one), so allow
            // the normal close-driven reconnect. The initial connect resolves as
            // failed so callers use REST.
            onSubscribed?.(false);
          }
          break;
        default:
          break;
      }
      return;
    }

    // Binary CRDT frame.
    const data = new Uint8Array(event.data as ArrayBuffer);
    if (data.length < HEADER_LEN) return;
    const tag = data[0];
    const payload = data.subarray(HEADER_LEN);
    if (tag === SYNC_STEP1) {
      // Peer's state vector: reply with everything it is missing.
      const update = Y.encodeStateAsUpdate(this.doc, payload);
      this.sendBinary(SYNC_UPDATE, update);
    } else if (tag === SYNC_UPDATE) {
      Y.applyUpdate(this.doc, payload, REMOTE_ORIGIN);
      if (this.initialSyncPending) {
        this.initialSyncPending = false;
        this.setStatus('connected');
        this.subscribedCallback?.(true);
        this.subscribedCallback = undefined;
      }
    } else if (tag === AWARENESS) {
      try {
        applyAwarenessUpdate(this.awareness, payload, REMOTE_AWARENESS_ORIGIN);
      } catch {
        // Awareness is untrusted peer input. Ignore malformed ephemeral state
        // without interrupting the durable document session.
      }
    }
  }

  /**
   * Marks the session unrecoverable, resolves any pending connect as failed, and
   * closes the socket without scheduling a reconnect. Used for protocol-version
   * mismatches where retrying with the same client cannot succeed.
   */
  private failFatally(onSubscribed?: (ok: boolean) => void) {
    this.fatal = true;
    onSubscribed?.(false);
    this.subscribedCallback?.(false);
    this.subscribedCallback = undefined;
    this.setStatus('disconnected');
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      try {
        socket.close();
      } catch {
        // ignore
      }
    }
  }

  private scheduleReconnect() {
    if (this.destroyed || this.fatal || this.reconnectTimer) return;
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempts,
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.openSocket();
    }, delay);
  }

  noteSession(): LiveDocumentSession {
    return {
      ...this.handle(),
      text: this.doc.getText(NOTE_TEXT_NAME),
    };
  }

  destroy() {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.doc.off('update', this.handleLocalUpdate);
    // Broadcast a final removal update when destruction is graceful. Unexpected
    // disconnects still age out through y-protocols awareness staleness.
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'destroy');
    this.awareness.off('update', this.handleAwarenessUpdate);
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket.onmessage = null;
      try {
        this.socket.close();
      } catch {
        // ignore
      }
      this.socket = null;
    }
    this.awareness.destroy();
    this.doc.destroy();
  }
}

/**
 * Resolves the live target and opens a connected provider, or returns `null`
 * when live collaboration is unavailable so callers fall back to REST. Shared by
 * the note (text) and structured (JSON) session entry points.
 */
export async function connectLiveProvider(
  client: VaultClient,
  relativePath: string,
): Promise<WebSocketYProvider | null> {
  if (!client.resolveLiveSession) return null;
  let target: LiveTarget | null;
  try {
    target = await client.resolveLiveSession(relativePath);
  } catch {
    return null;
  }
  if (!target) return null;

  const provider = new WebSocketYProvider(target);
  const ok = await provider.connectOnce();
  if (!ok) {
    provider.destroy();
    return null;
  }
  return provider;
}

/**
 * Opens a live collaboration session for a hosted note, or returns `null` when
 * live collaboration is unavailable so the caller falls back to REST.
 */
export async function openLiveNoteSession(
  client: VaultClient,
  relativePath: string,
): Promise<LiveDocumentSession | null> {
  const provider = await connectLiveProvider(client, relativePath);
  return provider ? provider.noteSession() : null;
}
