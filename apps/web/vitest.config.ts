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
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    css: false,
  },
});
