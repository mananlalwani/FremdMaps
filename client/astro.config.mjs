// @ts-check
import { defineConfig } from 'astro/config'
import AstroPWA from '@vite-pwa/astro'

// https://astro.build/config
export default defineConfig({
  vite: {
    // workbox-window uses browser APIs; exclude from SSR bundling pass
    ssr: {
      noExternal: ['@vite-pwa/astro'],
    },
  },
  integrations: [
    AstroPWA({
      registerType: 'autoUpdate',

      manifest: {
        name: 'School Navigator',
        short_name: 'Navigator',
        description: 'Indoor navigation for school floors',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },

      workbox: {
        // Precache everything in dist/ — app shell, data JSON, all 2397 tiles,
        // floor images, favicons, icons
        globPatterns: ['**/*.{html,js,css,json,png,svg,ico,xml,webmanifest}'],

        // Don't limit precache size — tiles can be ~20 MB total
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // 10 MB per file

        runtimeCaching: [
          // Google Fonts CSS — stale-while-revalidate so offline falls back to cache
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-stylesheets',
            },
          },
          // Google Fonts files — cache-first, long-lived
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
})
