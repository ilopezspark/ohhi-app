import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { touchActivity } from '../api/presence';

SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient();

export default function RootLayout() {
  const appState = useRef(AppState.currentState);

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

  return (
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
  );
}
