import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import {
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
  Outfit_800ExtraBold,
} from '@expo-google-fonts/outfit';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { ThemeProvider } from '../theme';
import { touchActivity } from '../api/presence';

SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient();

export default function RootLayout() {
  const appState = useRef(AppState.currentState);

  // Design-system fonts (`docs/design/system.md`): Outfit 400/500/600/800 are
  // used across every screen, 700 shows up 26 times despite the screens'
  // own Google Fonts <link> never requesting it (see `theme/tokens.ts`'s
  // `fontFamilies` doc comment — loaded here anyway so `Text`'s `title`
  // variant renders as designed rather than falling back to a synthetic
  // bold). JetBrains Mono 500 is loaded for parity with every screen that
  // links it, even though none of them actually apply it yet (`theme/tokens.ts`'s
  // `mono` variant is reserved, not extracted).
  const [fontsLoaded, fontsError] = useFonts({
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
    Outfit_800ExtraBold,
    JetBrainsMono_500Medium,
  });

  useEffect(() => {
    // Hold the splash screen until fonts resolve (loaded or errored — never
    // block forever on a font fetch failure) so the very first frame never
    // flashes a system-font fallback before Outfit is ready.
    if (fontsLoaded || fontsError) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontsError]);

  useEffect(() => {
    // Fire once on mount (covers cold start) and again on every
    // background->active transition. touch_activity() requires a session;
    // when there isn't one yet this just fails silently — fine, since we
    // never surface it to the user (architecture plan §5: touch_activity is
    // the only write path for last_active_at, called on app foreground).
    touchActivity().catch(() => {});

    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      const cameToForeground = /inactive|background/.test(appState.current) && next === 'active';
      appState.current = next;
      if (cameToForeground) {
        touchActivity().catch(() => {});
      }
    });

    return () => subscription.remove();
  }, []);

  // Splash stays up (see the effect above) until this is true — nothing
  // renders under it in the meantime, so there's no fallback-font flash.
  if (!fontsLoaded && !fontsError) {
    return null;
  }

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(onboarding)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="profile/[id]" options={{ headerShown: true, title: 'Profile' }} />
          <Stack.Screen name="restricted" />
          <Stack.Screen name="+not-found" />
        </Stack>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
