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
      style: 'DARK',
      backgroundColor: '#1b6b5a',
    },
  },
  ios: {
    contentInset: 'never',
    preferredContentMode: 'mobile',
    scheme: 'InPlace',
  },
  android: {
    backgroundColor: '#1b6b5a',
  },
};

export default config;
