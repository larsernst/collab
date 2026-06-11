import { create } from 'zustand';
import type { ChatMessage, PresenceEntry } from '../types/collab';
import type { ConflictInfo } from '../types/vault';
import { userColorForId } from '../lib/userColor';

interface CollabState {
  myUserId: string;
  myUserName: string;
  myUserColor: string;
  peers: PresenceEntry[];
  conflicts: ConflictInfo[];
  chatMessages: ChatMessage[];
  chatTypingUntil: number | null;
  setPeers: (peers: PresenceEntry[]) => void;
  addConflict: (conflict: ConflictInfo) => void;
  dismissConflict: (relativePath: string) => void;
  setMyProfile: (userId: string, userName: string, userColor: string) => void;
  setChatMessages: (msgs: ChatMessage[]) => void;
  mergeChatMessages: (msgs: ChatMessage[]) => void;
  appendChatMessage: (msg: ChatMessage) => void;
  setChatTypingUntil: (timestamp: number | null) => void;
}

function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const msg of existing) byId.set(msg.id, msg);
  for (const msg of incoming) byId.set(msg.id, msg);
  return Array.from(byId.values()).sort((a, b) => a.timestamp - b.timestamp);
}

export const useCollabStore = create<CollabState>()((set) => {
  const storedId = localStorage.getItem('collab-user-id');
  const userId = storedId ?? crypto.randomUUID();
  if (!storedId) localStorage.setItem('collab-user-id', userId);
  const storedName = localStorage.getItem('collab-user-name');
  const userName = storedName ?? `User ${userId.slice(0, 4)}`;
  const userColor = userColorForId(userId);

  return {
    myUserId: userId,
    myUserName: userName,
    myUserColor: userColor,
    peers: [],
    conflicts: [],
    chatMessages: [],
    chatTypingUntil: null,
    setPeers: (peers) => set({ peers }),
    addConflict: (conflict) =>
      set((state) => ({
        conflicts: [...state.conflicts.filter((c) => c.relativePath !== conflict.relativePath), conflict],
      })),
    dismissConflict: (relativePath) =>
      set((state) => ({ conflicts: state.conflicts.filter((c) => c.relativePath !== relativePath) })),
    setMyProfile: (myUserId, myUserName, myUserColor) => {
      localStorage.setItem('collab-user-id', myUserId);
      localStorage.setItem('collab-user-name', myUserName);
      set({ myUserId, myUserName, myUserColor });
    },
    setChatMessages: (chatMessages) => set({ chatMessages }),
    mergeChatMessages: (msgs) =>
      set((state) => ({ chatMessages: mergeMessages(state.chatMessages, msgs) })),
    appendChatMessage: (msg) =>
      set((state) => ({ chatMessages: mergeMessages(state.chatMessages, [msg]) })),
    setChatTypingUntil: (chatTypingUntil) => set({ chatTypingUntil }),
  };
});
