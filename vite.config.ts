import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';

// Versionskennung: Commit + Datum (auf GitHub aus GITHUB_SHA), für die Anzeige in der App
function appVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  let sha = (process.env.GITHUB_SHA ?? '').slice(0, 7);
  if (!sha) {
    try {
      sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    } catch {
      sha = 'lokal';
    }
  }
  const d = new Date();
  const date = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  return `${sha} · ${date}`;
}

export default defineConfig({
  // Relative Pfade: die App kann in einem beliebigen Unterordner gehostet werden.
  base: './',
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'BauPad',
        short_name: 'BauPad',
        description: 'BauPad – digitales Aufmaß von Schadstellen bei der Betoninstandsetzung',
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
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
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
