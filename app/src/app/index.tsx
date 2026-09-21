import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../api/client';
import { resolveEntryHref } from '../routing/bootstrap';
import * as SplashScreen from 'expo-splash-screen';

/**
 * The root layout's session-bootstrap screen: restores the session
 * (`getSession()`, backed by SecureStore), then runs the
 * auth -> begin_signup() -> me() -> route-by-state sequence and replaces
 * this screen with the resolved destination. Never renders the `(auth)`
 * group while a valid session is still resolving — a stale "signed out"
 * flash is a bug (architecture plan §4 step 4).
 */
export default function Index() {
  useEffect(() => {
    let cancelled = false;

    async function run() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const href = await resolveEntryHref(session);
      if (!cancelled) {
        SplashScreen.hideAsync().catch(() => {});
        router.replace(href as never);
      }
    }

    run().catch(() => {
      if (!cancelled) {
        SplashScreen.hideAsync().catch(() => {});
        // Same destination `resolveEntryHref`'s own no-session/failure path
        // resolves to (`routeResultToHref({ screen: 'auth' })` ->
        // `(auth)/welcome`) — this is the walking-skeleton's guarded "no
        // screen exists to retry" fallback, not a second policy.
        router.replace('/(auth)/welcome' as never);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.container} testID="bootstrap-loading">
      <ActivityIndicator size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
