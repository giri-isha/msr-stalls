import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/** The manifest's colours, as hex.
 *
 *  ⚠️ A manifest takes a single hex and the design tokens in
 *  `src/modules/stalls/ui/tokens.css` are oklch, so these are the CONVERTED
 *  values of `--pri` and `--bg` in the LIGHT theme — a manifest has no notion
 *  of a theme, and the install splash is what they drive. `tools/make-icons.py`
 *  does the same conversion for the icons, from the same source. Keep them in
 *  step with the tokens; nothing enforces it, because nothing can read oklch at
 *  config time. */
const BRAND = '#372aac';
const GROUND_LIGHT = '#f9fafc';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // ⚠️ 'prompt', never 'autoUpdate'. A new version installs and WAITS, and
      // reloading is the person's call — an auto-reload would discard a
      // half-filled request form or an open dialog, and this app is used on a
      // phone at a counter where that is somebody's evening. See `UpdateToast`.
      registerType: 'prompt',
      includeAssets: ['favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'MSR Stalls',
        // The launcher label. Short on purpose — Android truncates around 12
        // characters and "MSR Stalls" already fits, so it is the same words
        // rather than a second abbreviation to keep in step.
        short_name: 'MSR Stalls',
        description: 'Stall requests, selection and operations for Maha Shivratri.',
        id: '/',
        // 🔴 The BACKOFFICE, not the public form. An installed app is installed
        // by the team who work it every day; a vendor fills one form once, from
        // a link in an email, and would be handed an icon for a screen they
        // will never open again.
        start_url: '/m/stalls',
        // ⚠️ '/' and not '/m/stalls'. The scope is what the worker may control
        // and what counts as "inside" the app — narrowing it to the backoffice
        // would send a coordinator following a link to a vendor's status page
        // out to the browser, and back in through a cold start.
        scope: '/',
        display: 'standalone',
        background_color: GROUND_LIGHT,
        theme_color: BRAND,
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          // ⚠️ Maskable icons are SEPARATE files, not the same ones relabelled.
          // A launcher crops a maskable icon to its own shape — a circle on
          // Android — so the mark sits inside the middle 80% on an opaque
          // ground. Pointing `purpose: 'maskable'` at the plain icons crops the
          // corners off the tile, and only on the devices that do the cropping.
          { src: 'maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        // ⚠️ The default 2 MiB cap silently DROPS a file from the precache
        // rather than failing the build, and this bundle self-hosts two
        // variable fonts. A dropped file is an app that launches broken
        // offline with nothing in the build output to say why.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // 🔴 `/api` is EXCLUDED from the navigation fallback. Without this, a
        // request the worker cannot reach the network for is answered with
        // index.html — so the app receives an HTML page where it expected JSON
        // and fails with a parse error instead of an offline one.
        navigateFallbackDenylist: [/^\/api/],
      },
      devOptions: {
        // ⚠️ Off. A service worker in dev caches around Vite's HMR and produces
        // bugs that do not exist in production. Flip it to debug the worker.
        enabled: false,
      },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    // The API sets an HttpOnly session cookie; proxying keeps it same-origin
    // in development so the browser sends it back without any CORS dance.
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: false } },
  },
});
