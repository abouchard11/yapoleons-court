import type { CapacitorConfig } from '@capacitor/cli';

// Dark mode (forked from the source engine, D-09/DM-04): the hex/style values below are the
// PRE-JS LIGHT DEFAULTS only — at runtime applyAppearanceChrome (src/appearance-chrome.ts,
// reintroduced with the RoundScreen in Plan 01-02) sets the status bar + theme-color from
// the RESOLVED appearance (manual override included). Documented platform exception: the
// launch screen renders before JS boots, so it follows OS appearance only (via the
// LaunchBackground asset-catalog color: Any=#FBF6EC, Dark=#1C1C1E); a manual override
// applies from the first runtime frame onward.
const config: CapacitorConfig = {
  appId: 'com.midnightdev.yapoleonscourt',
  appName: "Yapoleon's Court",
  webDir: 'dist',
  ios: {
    contentInset: 'always',
    scrollEnabled: true,
    backgroundColor: '#FBF6EC',
    scheme: 'App',
  },
  plugins: {
    StatusBar: {
      style: 'dark',
      backgroundColor: '#FBF6EC',
    },
    // resize MUST stay 'none' (BUG-2026-06-10-webview-viewport-corruption):
    // 'body'/'native' make the plugin mutate layout through delayed, cancelable
    // callbacks; a native overlay (StoreKit) interrupting that cycle leaves the
    // viewport permanently desynced. All keyboard inputs live in fixed-position
    // overlays (visualViewport-pinned), so no resize mode is needed.
    Keyboard: {
      resize: 'none',
    },
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#FBF6EC',
      showSpinner: false,
    },
  },
  ...(process.env.CAPACITOR_LIVE_RELOAD === '1' && {
    server: {
      url: 'http://127.0.0.1:5173',
      cleartext: true,
    },
  }),
};

export default config;
