import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.yourinplace.app',
  appName: 'InPlace',
  webDir: 'public',
  server: {
    // Use the live Railway server — web assets load from your deployed PWA
    // Comment this out to use local bundled assets instead
    url: 'https://yourinplace.com',
    cleartext: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 2000,
      backgroundColor: '#1b6b5a',
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    StatusBar: {
      // 'LIGHT' = light background / dark text — matches InPlace's white header
      // ('DARK' was showing invisible white text on white background)
      style: 'LIGHT',
      backgroundColor: '#ffffff',
      overlaysWebView: true,
    },
  },
  ios: {
    contentInset: 'never',
    preferredContentMode: 'mobile',
    scheme: 'InPlace',
  },
  android: {
    backgroundColor: '#ffffff',
  },
};

export default config;
