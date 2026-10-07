import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const api = process.env.RELAY_API ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // widget.js is deliberately NOT precached: it must always be fresh for embedding sites.
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Relay — AI support inbox',
        short_name: 'Relay',
        description: 'Open-source AI support agent for WhatsApp and web chat.',
        theme_color: '#4f46e5',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/app',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/widget/, /^\/webhooks/, /^\/demo-api/, /^\/healthz/],
        globIgnores: ['**/widget.js'],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: api, changeOrigin: true },
      '/widget/': { target: api, changeOrigin: true },
      '/demo-api': { target: api, changeOrigin: true },
      '/webhooks': { target: api, changeOrigin: true },
    },
  },
});
