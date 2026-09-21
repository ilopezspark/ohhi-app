import type { ExpoConfig } from 'expo/config';

// app.config.ts instead of a static app.json per docs/app-architecture-plan.md §8:
// EAS profiles (development/preview/production) vary EXPO_PUBLIC_SUPABASE_URL /
// EXPO_PUBLIC_SUPABASE_ANON_KEY through EAS environment variables, so the values below
// need to be read at config-eval time, not hardcoded. The Expo CLI loads `.env` into
// process.env automatically before evaluating this file — no dotenv package needed.
const config: ExpoConfig = {
  name: 'OhHi',
  slug: 'ohhi-app',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'ohhi',
  userInterfaceStyle: 'automatic',
  ios: {
    icon: './assets/expo.icon',
  },
  android: {
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    // 'single' (client-only, no server-side prerender), not 'static': the
    // architecture plan doesn't target web at all (EAS profiles are
    // iOS/Android only, §8), and expo-secure-store's web shim isn't
    // Node-prerender-safe, which 'static' output requires. This is enough
    // for the `expo export --platform web` smoke check.
    output: 'single',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#208AEF',
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
      },
    ],
    'expo-secure-store',
    'expo-web-browser',
    [
      // Foreground-only, per decision 5 and brief §4: no "Always" permission,
      // no background location, no `startLocationUpdatesAsync`. Only
      // `locationWhenInUsePermission` is set — deliberately not
      // `locationAlwaysAndWhenInUsePermission`, so the Always strings never
      // enter the Info.plist and the app can't request that authorisation
      // even by mistake.
      'expo-location',
      {
        locationWhenInUsePermission:
          'OhHi uses your location only to show whether you’re on campus, nearby, or in the ' +
          'county — never your exact spot, and never while the app is closed.',
        isIosBackgroundLocationEnabled: false,
        isAndroidBackgroundLocationEnabled: false,
        isAndroidForegroundServiceEnabled: false,
      },
    ],
    '@react-native-community/datetimepicker',
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    // Read by src/api/client.ts. Never the service-role key — see .env.example.
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  },
};

export default config;
