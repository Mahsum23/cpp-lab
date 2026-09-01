import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages project sites live under /<repo>/. Set APP_BASE=/cpp-lab/ when
// building for one; the default suits a root deploy (Vercel, Netlify, user Pages).
const base = process.env.APP_BASE ?? '/';

export default defineConfig({
  base,
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
        name: 'cpp-lab',
        short_name: 'cpp-lab',
        description: 'One C++ session a day. Theory, quiz, task — 25 minutes.',
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
        globIgnores: ['**/content/**'],
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/content/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'cpp-lab-content',
              networkTimeoutSeconds: 5,
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
