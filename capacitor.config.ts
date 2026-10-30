import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Store-App (Android, später iOS) – verpackt die Web-App aus `dist`. Die App lädt die Dateien lokal
 * (Ursprung https://localhost), spricht mit Supabase und der zentralen Ablage wie die Website.
 * Bauen: GitHub Actions „Android-App“ (siehe docs/android-app.md).
 */
const config: CapacitorConfig = {
  appId: 'at.padsoftware.baupad',
  appName: 'BauPad',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    backgroundColor: '#000000',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 800,
      backgroundColor: '#000000',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
  },
};

export default config;
