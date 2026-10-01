import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages project sites live under /<repo>/. Set APP_BASE=/slowpath/ when
// building for one; the default suits a root deploy (Vercel, Netlify, user Pages).
const base = process.env.APP_BASE ?? '/';

// Stamped into the bundle so the running app can say which build it is. Without it,
// "is this deployed?" can only be answered by reading commit history and guessing
// whether the device took the update.
const buildId =
  process.env.GITHUB_SHA?.slice(0, 7) ??
  new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig({
  base,
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  // The SQL engine runs in a module worker, and PGlite finds its .wasm and .data files
  // with `new URL(..., import.meta.url)`, which Vite's dependency pre-bundler would break.
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  build: {
    target: 'es2022',
    // Phones on cellular: keep an eye on this, don't let it creep.
    chunkSizeWarningLimit: 400,
  },
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon.svg'],
      manifest: {
        id: base,
        name: 'slowpath',
        short_name: 'slowpath',
        description: 'One short session a day in C++, PostgreSQL or Go. Theory, quiz, drill, task, teach-back.',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0e1116',
        theme_color: '#0e1116',
        categories: ['education', 'developer'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The shell is precached. Curriculum JSON is deliberately NOT, so that a
        // pushed week shows up without shipping a new app build (DESIGN.md §7).
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The SQL engine (a PostgreSQL compiled to WebAssembly, ~5 MB over the wire) is
        // not part of installing the app: it is fetched the first time a "write it" card
        // is dealt and cached then (runtimeCaching below), so a phone that never reaches
        // one never pays for it.
        globIgnores: ['**/content/**', '**/sqlrun.worker-*.js', '**/opfs-ahp-*.js', '**/nodefs-*.js', '**/__vite-browser-external-*.js'],
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // File names carry a content hash, so a cached copy is never stale.
            urlPattern: ({ url }) => /\/assets\/(pglite|initdb|sqlrun\.worker|opfs-ahp|nodefs|__vite-browser-external)-/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'slowpath-sql-engine',
              expiration: { maxEntries: 12 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.includes('/content/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'cpp-lab-content',
              networkTimeoutSeconds: 5,
              // Requests carry a cache-busting query (content.ts); the offline copy is
              // the same file whatever the query said.
              matchOptions: { ignoreSearch: true },
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});
