import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom does not always provide a localStorage implementation; the mobile store
// reads/writes it (known servers, theme). Provide a simple in-memory mock.
function createStorageMock() {
  let store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, String(value));
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store = new Map<string, string>();
    }),
    key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
    get length() {
      return store.size;
    },
  };
}

const localStorageMock = createStorageMock();
for (const target of [globalThis, window]) {
  Object.defineProperty(target, 'localStorage', {
    writable: true,
    configurable: true,
    value: localStorageMock,
  });
}

afterEach(() => {
  cleanup();
});
