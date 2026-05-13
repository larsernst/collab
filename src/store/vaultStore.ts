import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { tauriCommands } from '../lib/tauri';
import type { VaultMeta, NoteFile } from '../types/vault';

interface VaultState {
  vault: VaultMeta | null;
  isVaultLocked: boolean;
  fileTree: NoteFile[];
  recentVaults: VaultMeta[];
  lastOpenedVaultPath: string | null;
  isLoading: boolean;
  openVault: (path: string) => Promise<void>;
  unlockVault: (password: string) => Promise<void>;
  refreshFileTree: () => Promise<void>;
  closeVault: () => void;
  loadRecentVaults: () => Promise<void>;
  removeRecentVault: (path: string) => Promise<void>;
}

function compareNoteFilesAlphabetically(left: NoteFile, right: NoteFile) {
  if (left.isFolder !== right.isFolder) return left.isFolder ? -1 : 1;
  const nameOrder = left.name.localeCompare(right.name, undefined, {
    sensitivity: 'base',
    numeric: true,
  });
  if (nameOrder !== 0) return nameOrder;
  return left.relativePath.localeCompare(right.relativePath, undefined, {
    sensitivity: 'base',
    numeric: true,
  });
}

export function sortFileTreeAlphabetically(nodes: NoteFile[]): NoteFile[] {
  return [...nodes]
    .map((node) => ({
      ...node,
      children: node.children ? sortFileTreeAlphabetically(node.children) : node.children,
    }))
    .sort(compareNoteFilesAlphabetically);
}

function isLikelyFlatpakVaultAccessError(error: unknown) {
  const message = String(error ?? '').toLowerCase();
  return (
    message.includes('cannot open vault path')
    && (
      message.includes('no such file or directory')
      || message.includes('os error 2')
    )
  );
}

export const useVaultStore = create<VaultState>()(
  persist(
    (set, get) => ({
      vault: null,
      isVaultLocked: false,
      fileTree: [],
      recentVaults: [],
      lastOpenedVaultPath: null,
      isLoading: false,
      openVault: async (path) => {
        const attemptOpenVault = async (vaultPath: string) => {
          await tauriCommands.unwatchVault().catch(() => {});
          const vault = await tauriCommands.openVault(vaultPath);
          if (vault.isEncrypted) {
            // Don't load the file tree yet — wait for the password to be entered.
            set({ vault, isVaultLocked: true, fileTree: [], isLoading: false, lastOpenedVaultPath: vaultPath });
            return;
          }

          const fileTree = sortFileTreeAlphabetically(await tauriCommands.listVaultFiles(vault.path));
          await tauriCommands.watchVault(vault.path);
          set({ vault, isVaultLocked: false, fileTree, isLoading: false, lastOpenedVaultPath: vaultPath });
        };

        set({ isLoading: true });
        try {
          await attemptOpenVault(path);
        } catch (e) {
          if (await tauriCommands.isFlatpak().catch(() => false) && isLikelyFlatpakVaultAccessError(e)) {
            const reauthorizedPath = await tauriCommands.showOpenVaultDialog().catch(() => null);
            if (!reauthorizedPath) {
              set({ isLoading: false });
              return;
            }
            await attemptOpenVault(reauthorizedPath);
            return;
          }

          set({ isLoading: false });
          throw e;
        }
      },
      unlockVault: async (password) => {
        const { vault } = get();
        if (!vault) return;
        await tauriCommands.unlockVault(vault.path, password);
        const fileTree = sortFileTreeAlphabetically(await tauriCommands.listVaultFiles(vault.path));
        await tauriCommands.watchVault(vault.path);
        set({ isVaultLocked: false, fileTree });
      },
      refreshFileTree: async () => {
        const { vault } = get();
        if (!vault) return;
        const fileTree = sortFileTreeAlphabetically(await tauriCommands.listVaultFiles(vault.path));
        set({ fileTree });
      },
      closeVault: () => {
        tauriCommands.unwatchVault().catch(() => {});
        set({ vault: null, isVaultLocked: false, fileTree: [] });
      },
      loadRecentVaults: async () => {
        const recentVaults = await tauriCommands.getRecentVaults();
        set({ recentVaults });
      },
      removeRecentVault: async (path) => {
        await tauriCommands.removeRecentVault(path);
        set((s) => ({ recentVaults: s.recentVaults.filter((v) => v.path !== path) }));
      },
    }),
    {
      name: 'vault-storage',
      partialize: (state) => ({ recentVaults: state.recentVaults, lastOpenedVaultPath: state.lastOpenedVaultPath }),
    }
  )
);
