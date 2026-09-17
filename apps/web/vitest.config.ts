import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // ⚠️ `vite-plugin-pwa` generates this module at BUILD time and this config
      // does not run that plugin — registering a service worker during a unit
      // test caches around jsdom and fails in ways unrelated to the test. See
      // the stub for what it answers and why.
      'virtual:pwa-register/react': fileURLToPath(
        new URL('./src/test-stubs/pwa-register.ts', import.meta.url),
      ),
    },
  },
  test: {
    // ⚠️ Above vitest's 5s default, and it is the SUITE that needs it rather
    // than any one test. These are full render-and-drive tests — a request
    // form draws forty questions and a test types through them — and at ~340
    // of them the slowest half-dozen cross 5s whenever the machine is busy.
    // They pass in isolation and failed only in a full run, which is the
    // signature of a timeout rather than a bug: the failures moved around
    // between runs and never reproduced alone.
    testTimeout: 20_000,
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    css: false,
  },
});
