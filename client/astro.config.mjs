// @ts-check
import { defineConfig } from 'astro/config'
import AstroPWA from '@vite-pwa/astro'

// https://astro.build/config
export default defineConfig({
  compressHTML: true,
  vite: {
    ssr: {
      noExternal: ['@vite-pwa/astro'],
    },
  },
  integrations: [
    AstroPWA({
      registerType: 'prompt',
      devOptions: {
        enabled: false,
      },

      manifest: {
        name: 'Fremd Maps',
        short_name: 'Fremd',
        description: 'Indoor navigation for school floors',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        display: 'standalone',
        orientation: 'any',
        lang: 'en',
        categories: ['education', 'navigation', 'utilities'],
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
        globPatterns: ['**/*.{html,js,css,json,png,webp,svg,ico,xml,webmanifest}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [
          /^\/_astro\//,
          /\/data\//,
          /\/icons\//,
          /\.(?:png|webp|svg|ico|json|webmanifest|js|css|xml)$/,
        ],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
