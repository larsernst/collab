import { useEffect, useState } from 'react';

export type AdminTheme = 'dark' | 'midnight' | 'warm' | 'light';
export type AdminAccent = 'violet' | 'blue' | 'emerald' | 'rose' | 'orange' | 'cyan';

export interface AdminAppearance {
  theme: AdminTheme;
  accent: AdminAccent;
  compact: boolean;
}

export const DEFAULT_APPEARANCE: AdminAppearance = {
  theme: 'dark',
  accent: 'violet',
  compact: false,
};

const STORAGE_KEY = 'collab-admin-appearance';

function storage() {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function loadAppearance(): AdminAppearance {
  try {
    return { ...DEFAULT_APPEARANCE, ...JSON.parse(storage()?.getItem(STORAGE_KEY) ?? '{}') };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function useAdminAppearance() {
  const [appearance, setAppearance] = useState(loadAppearance);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = appearance.theme;
    root.dataset.accent = appearance.accent;
    root.dataset.density = appearance.compact ? 'compact' : 'comfortable';
    storage()?.setItem(STORAGE_KEY, JSON.stringify(appearance));
  }, [appearance]);

  return { appearance, setAppearance };
}
