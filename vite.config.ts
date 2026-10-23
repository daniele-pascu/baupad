import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative Pfade: die App kann in einem beliebigen Unterordner gehostet werden.
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'Schadstellen-Aufmaß',
        short_name: 'Aufmaß',
        description: 'Digitale Erfassung von Schadstellen bei der Betoninstandsetzung',
        lang: 'de',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f4f5f7',
        theme_color: '#1f4e79',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Alles, was die App offline braucht – inklusive pdf.js-Worker, Schriften, CMaps und WASM.
        globPatterns: ['**/*.{js,mjs,css,html,png,svg,ico,webmanifest,bcmap,pfb,ttf,wasm,icc}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2500,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
  },
});
