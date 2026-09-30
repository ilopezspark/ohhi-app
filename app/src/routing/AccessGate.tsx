import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router, useRootNavigationState, useSegments } from 'expo-router';
import { colors } from '../theme/tokens';
import { useAccessQuery } from './access';
import { guardRedirect, zoneForSegments } from './guard';

/**
 * The age gate at the layout level (decision 97, `docs/age-gate-contract.md`):
 * mounted once in `app/_layout.tsx`, beside the root stack, so no route can
 * be reached around it — not a deep link, not a tab, not a pushed screen.
 * It never decides anything itself: `routing/guard.ts` maps the current
 * route's zone and `me()`'s route to a redirect.
 *
 * `me()` is the shared access read (`routing/access.ts`): fresh on sign-in and
 * sign-out (its key carries the user id), on app foreground, and whenever a
 * screen polls or refetches it, so the moment a check passes, fails or closes
 * the account, this sends the person where they now belong.
 *
 * While the first read for a session is still out, a protected screen is
 * covered (paper and a spinner), so a cold-start deep link never shows the
 * app before the state is known. The stack stays mounted underneath; the
 * router needs it to navigate at all.
 */
export function AccessGate() {
  const segments = useSegments();
  const navigationState = useRootNavigationState();
  const { userId, query, route } = useAccessQuery();
  const zone = zoneForSegments(segments);
  const target = guardRedirect(zone, route);
  const targetKey = target ? JSON.stringify(target) : null;
  const lastRedirect = useRef<string | null>(null);

  useEffect(() => {
    if (!navigationState?.key || !target || !targetKey) {
      lastRedirect.current = null;
      return;
    }
    // One replace per target: the effect re-runs on every segment change,
    // and the navigation it causes is one of them.
    if (lastRedirect.current === targetKey) return;
    lastRedirect.current = targetKey;
    router.replace(target as never);
  }, [navigationState?.key, target, targetKey]);

  const protectedZone = zone === 'onboarding' || zone === 'verify' || zone === 'restricted' || zone === 'app';
  const unknown = userId === undefined || (userId !== null && query.isPending);
  if (!protectedZone || !(unknown || target)) return null;

  return (
    <View style={styles.cover} testID="access-gate-cover" pointerEvents="auto">
      <ActivityIndicator size="large" color={colors.ink} />
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper,
  },
});
