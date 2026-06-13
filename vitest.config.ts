import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
    // Project tests live under src/. Scoping the glob here keeps vitest from
    // picking up source copies inside generated build trees (e.g.
    // `.flatpak-builder/`, `flatpak/`), whose modules cannot resolve.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
