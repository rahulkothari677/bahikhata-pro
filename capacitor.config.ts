import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'pro.ekbook.app',
  appName: 'EkBook',
  webDir: '.next/standalone/.next/static',
  bundledWebRuntime: false,
  server: {
    // Use live URL during development, switch to local for production builds
    url: 'https://bahikhata-pro.vercel.app',
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#d97706',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#d97706',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      android: {
        backgroundColor: '#d97706',
        nm: true,
      },
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#d97706',
      overlaysWebView: false,
    },
    Haptics: {
      // Native haptic feedback (replaces navigator.vibrate)
    },
  },
}

export default config
