import { useEffect } from 'react';
import { create } from 'zustand';

import type { DocumentStatus } from '../lib/documentSessionController';

export interface RegisteredDocumentStatus {
  status: DocumentStatus;
  onLoadRemote?: () => void;
  onKeepLocal?: () => void;
}

interface DocumentStatusState {
  statuses: Record<string, RegisteredDocumentStatus>;
  setDocumentStatus: (relativePath: string, status: RegisteredDocumentStatus) => void;
  clearDocumentStatus: (relativePath: string) => void;
}

export const useDocumentStatusStore = create<DocumentStatusState>((set) => ({
  statuses: {},
  setDocumentStatus: (relativePath, status) =>
    set((state) => ({
      statuses: {
        ...state.statuses,
        [relativePath]: status,
      },
    })),
  clearDocumentStatus: (relativePath) =>
    set((state) => {
      if (!(relativePath in state.statuses)) return state;
      const { [relativePath]: _removed, ...statuses } = state.statuses;
      return { statuses };
    }),
}));

export function useDocumentStatusRegistration(
  relativePath: string | null | undefined,
  status: RegisteredDocumentStatus | null,
): void {
  const setDocumentStatus = useDocumentStatusStore((state) => state.setDocumentStatus);
  const clearDocumentStatus = useDocumentStatusStore((state) => state.clearDocumentStatus);

  useEffect(() => {
    if (!relativePath || !status) return;
    setDocumentStatus(relativePath, status);
    return () => clearDocumentStatus(relativePath);
  }, [clearDocumentStatus, relativePath, setDocumentStatus, status]);
}
