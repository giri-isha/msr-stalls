import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    // The API sets an HttpOnly session cookie; proxying keeps it same-origin
    // in development so the browser sends it back without any CORS dance.
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: false } },
  },
});
