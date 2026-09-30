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
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { ThemeProvider } from '../theme';
import { touchActivity } from '../api/presence';
import { wireQueryLifecycle } from '../query/lifecycle';
import { AccessGate } from '../routing/AccessGate';

SplashScreen.preventAutoHideAsync().catch(() => {});

// App foreground counts as a window focus and NetInfo drives online/offline,
// so stale queries refetch on foreground and on reconnect (see
// `query/lifecycle.ts`). Nothing is pushed when someone vanishes (decision
// 90), so these refetches are how every screen finds out.
wireQueryLifecycle();

const queryClient = new QueryClient();

export default function RootLayout() {
  const appState = useRef(AppState.currentState);

  // Design-system fonts (`docs/design/system.md`): Outfit 400/500/600/800 are
  // used across every screen, 700 shows up 26 times despite the screens'
  // own Google Fonts <link> never requesting it (see `theme/tokens.ts`'s
  // `fontFamilies` doc comment — loaded here anyway so `Text`'s `title`
  // variant renders as designed rather than falling back to a synthetic
  // bold). JetBrains Mono is not loaded: the product owner's 21 September
  // 2026 ruling on deviation 2 (`docs/design/system.md`) confirmed it was
  // loaded-but-unused dead weight in every one of the 24 screens (decision
  // 50, `docs/decisions.md`) — Outfit is the only typeface anywhere in the
  // app.
  const [fontsLoaded, fontsError] = useFonts({
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
    Outfit_800ExtraBold,
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

  // `KeyboardProvider` (react-native-keyboard-controller, in Expo Go): the
  // keyboard's height, frame by frame, for bars that sit on the keyboard
  // (`ui/KeyboardSpacer.tsx`). It sees the app is edge-to-edge and leaves the
  // window's insets alone.
  return (
    <KeyboardProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(onboarding)" />
            <Stack.Screen name="(tabs)" />
            {/* The profile redesign is full-bleed: its own back button sits on
                the photo, so the stack header is off. */}
            <Stack.Screen name="profile/[id]" />

            {/* Album stories (`albums/StoryViewer.tsx`): fade in like a story
                rather than sliding in like a page, and no iOS edge swipe back,
                which would fight the story's own drag to the previous photo
                (close is the x, a downward drag, or hardware back). */}
            <Stack.Screen name="chat/[id]/album/[albumId]" options={{ animation: 'fade', gestureEnabled: false }} />
            <Stack.Screen name="settings/albums/[id]" options={{ animation: 'fade', gestureEnabled: false }} />

            {/* Me redesign (docs/design/me-redesign/brief.md, ruling 11): the
                profile editor is presented modally over the tabs; QuickStatus is
                its own standalone modal from Me's status row. Both need
                `presentation: 'modal'` set here — it can't be set from inside
                the nested route itself. */}
            <Stack.Screen name="profile-editor" options={{ presentation: 'modal' }} />
            <Stack.Screen name="quick-status" options={{ presentation: 'modal' }} />
            <Stack.Screen name="interests" options={{ presentation: 'modal' }} />
            {/* The age gate's standalone verify screen (decision 97): an
                active or paused account that is not verified. */}
            <Stack.Screen name="verify-id" options={{ gestureEnabled: false }} />
            <Stack.Screen name="restricted" options={{ gestureEnabled: false }} />
            <Stack.Screen name="+not-found" />
          </Stack>
          {/* The age gate at the layout level (decision 97,
              docs/age-gate-contract.md): only a verified adult with an
              active or paused account reaches the tabs and everything
              behind them; everyone else is sent to the step their state is
              on, whatever route or deep link they opened. */}
          <AccessGate />
        </QueryClientProvider>
      </ThemeProvider>
    </KeyboardProvider>
  );
}
