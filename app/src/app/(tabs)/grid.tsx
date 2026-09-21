import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  FlatList,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { gridForMe, type GridRow } from '../../api/grid';
import { me as fetchMe } from '../../api/me';
import { getMyPresence } from '../../api/presence';
import { listMyPhotos, signedPhotoUrls } from '../../api/photos';
import { startAndOpenVerification } from '../../api/verification';
import { Banner } from '../../grid/Banner';
import { GridTile } from '../../grid/GridTile';
import { notVisibleReason, REASON_COPY } from '../../grid/visibility';
import { LOCATION_PERMISSION_EXPLAINER, usePresence, usePresenceStore } from '../../presence';
import { getRealtimeManager, type HereNowEvent } from '../../realtime';

/**
 * The grid (`docs/app-onboarding-grid-plan.md` §3–§5).
 *
 * Refresh policy, read from the schema rather than assumed (§3):
 * - full refetch on mount, pull-to-refresh, app foreground, and a 75s poll
 *   (the note's proposed 60–90s), because **tier changes are not broadcast**;
 * - the one broadcast that does exist, `presence:campus:<campus_id>`, carries
 *   `{user_id, here_now}` and is merged into the held rows in place, dropping
 *   any `user_id` not already present — which is what keeps a blocked pair
 *   from observing each other through it;
 * - a reconnect/resubscribe invalidates rather than trusting the socket to
 *   have caught up while backgrounded.
 *
 * The RPC's own ordering (`tier asc, here_now desc, last_active_at desc`) is
 * never re-sorted here; rows render exactly as returned.
 */
export default function GridScreen() {
  const queryClient = useQueryClient();
  const [verifyBusy, setVerifyBusy] = useState(false);

  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: fetchMe });
  const campusId = meData?.campus_id ?? null;

  const presence = usePresence(campusId);

  const {
    data: rows,
    isPending,
    isError,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['grid_for_me'],
    queryFn: gridForMe,
    // Most tier changes are never pushed (§3), so the grid polls.
    refetchInterval: 75_000,
    refetchOnWindowFocus: true,
  });

  // Reads 2 and 3 of §3.1's three-read visibility check (read 1 is `me()`).
  const { data: myPresence } = useQuery({ queryKey: ['my_presence'], queryFn: getMyPresence });
  const { data: myPhotos } = useQuery({ queryKey: ['my_photos'], queryFn: listMyPhotos });

  // ---------------------------------------------------------------------
  // Seed the presence store from server state, once each value is known.
  //
  // Written straight into the store rather than through
  // `presence.setHereNow`/`setPaused`, which would post the value we just
  // read back to the server. Seeded once each: after that the store is
  // authoritative for the toggles, so a slow refetch can't stomp on a tap.
  // ---------------------------------------------------------------------
  const seededHereNow = useRef(false);
  useEffect(() => {
    if (seededHereNow.current || meData === undefined) return;
    seededHereNow.current = true;
    usePresenceStore.getState().setHereNow(!!meData?.here_now);
  }, [meData]);

  const seededPaused = useRef(false);
  useEffect(() => {
    if (seededPaused.current || myPresence === undefined) return;
    seededPaused.current = true;
    usePresenceStore.getState().setPaused(myPresence?.is_visible === false);
  }, [myPresence]);

  // ---------------------------------------------------------------------
  // Refetch on a computed-tier change.
  //
  // Note §3's own caveat: the caller's own tier never changes what their own
  // `grid_for_me()` returns (`is_grid_visible` only ever looks at the
  // *target's* tier). This refetch is therefore belt-and-braces — it exists
  // because a tier change is also the moment the user most likely moved, i.e.
  // exactly when other people's rows are most likely stale.
  // ---------------------------------------------------------------------
  // Depends on the stable callback, not the whole `presence` object — that is
  // a fresh literal on every render, which would resubscribe every time.
  const onTierChange = presence.onTierChange;
  useEffect(
    () =>
      onTierChange(() => {
        void queryClient.invalidateQueries({ queryKey: ['grid_for_me'] });
        void queryClient.invalidateQueries({ queryKey: ['my_presence'] });
      }),
    [onTierChange, queryClient]
  );

  // ---------------------------------------------------------------------
  // Realtime: one campus presence subscription, merged in place.
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!campusId) return;
    const manager = getRealtimeManager();

    const unsubscribe = manager.subscribeCampusPresence(campusId, {
      onHereNow: (event: HereNowEvent) => {
        queryClient.setQueryData<GridRow[]>(['grid_for_me'], (current) => {
          if (!current) return current;
          // Drop any user_id we don't already hold. A blocked user is never in
          // the other's grid, so this is what stops the broadcast becoming a
          // side channel that reveals them.
          if (!current.some((row) => row.user_id === event.user_id)) return current;
          return current.map((row) =>
            row.user_id === event.user_id ? { ...row, here_now: event.here_now } : row
          );
        });
      },
      onInvalidate: () => {
        void queryClient.invalidateQueries({ queryKey: ['grid_for_me'] });
      },
    });

    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') manager.reconnect();
    });

    return () => {
      subscription.remove();
      unsubscribe();
    };
  }, [campusId, queryClient]);

  // ---------------------------------------------------------------------
  // Photo URLs. Re-signed per fetch (60s expiry, architecture plan §7).
  // ---------------------------------------------------------------------
  const photoPaths = useMemo(
    () => (rows ?? []).map((row) => row.photo_path).filter((path): path is string => !!path),
    [rows]
  );
  const photoPathsKey = useMemo(() => [...photoPaths].sort().join('|'), [photoPaths]);
  const { data: photoUrls } = useQuery({
    queryKey: ['grid_photo_urls', photoPathsKey],
    queryFn: () => signedPhotoUrls(photoPaths),
    enabled: photoPaths.length > 0,
    staleTime: 45_000,
  });

  // ---------------------------------------------------------------------
  // Banners.
  // ---------------------------------------------------------------------
  const mainPhoto = myPhotos?.find((photo) => photo.position === 0) ?? null;
  const reason = notVisibleReason({
    status: meData?.status ?? null,
    verificationStatus: meData?.verification_status ?? null,
    mainPhotoState: mainPhoto?.moderation_state ?? null,
    isVisible: myPresence?.is_visible ?? null,
    tier: presence.tier ?? myPresence?.tier ?? null,
    tierComputedAt: myPresence?.tier_computed_at ?? null,
    permission: presence.permission,
    now: Date.now(),
  });

  const onVerify = useCallback(async () => {
    setVerifyBusy(true);
    try {
      await startAndOpenVerification();
    } catch {
      // Generic by design (decision 24) — the banner just stops spinning and
      // the user can try again. Never surface why.
    } finally {
      setVerifyBusy(false);
      // The result arrives via the provider's server-to-server webhook, so
      // re-read `me()` on dismiss rather than trusting a redirect.
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    }
  }, [queryClient]);

  const onEnableLocation = useCallback(async () => {
    const result = await presence.requestPermission();
    if (result === 'denied' && Platform.OS !== 'web') {
      // Already refused at the OS level: the prompt won't show again, so the
      // only way forward is Settings.
      void Linking.openSettings().catch(() => {});
    }
  }, [presence]);

  const onResume = useCallback(async () => {
    try {
      await presence.setPaused(false);
      await queryClient.invalidateQueries({ queryKey: ['my_presence'] });
    } catch {
      // Same generic treatment as every other RPC refusal.
    }
  }, [presence, queryClient]);

  const runReasonAction = useCallback(
    (action: 'verify' | 'enable_location' | 'resume' | null) => {
      if (action === 'verify') void onVerify();
      if (action === 'enable_location') void onEnableLocation();
      if (action === 'resume') void onResume();
    },
    [onVerify, onEnableLocation, onResume]
  );

  const onRefresh = useCallback(() => {
    void presence.refresh();
    void refetch();
    void queryClient.invalidateQueries({ queryKey: ['my_presence'] });
    void queryClient.invalidateQueries({ queryKey: ['me'] });
  }, [presence, refetch, queryClient]);

  const openProfile = useCallback((userId: string) => {
    router.push(`/profile/${userId}` as never);
  }, []);

  const reasonCopy = reason ? REASON_COPY[reason] : null;
  // §3.1 note 3: the paused banner already says this, so don't say it twice.
  const showReasonBanner = !!reasonCopy && reason !== 'paused';

  const header = (
    <View>
      <View style={styles.header}>
        <Text style={styles.title}>{meData?.campus_label ?? 'Grid'}</Text>
        <View style={styles.headerControls}>
          <Pressable
            testID="here-now-toggle"
            accessibilityRole="switch"
            accessibilityState={{ checked: presence.hereNow }}
            onPress={() => void presence.setHereNow(!presence.hereNow).catch(() => {})}
            style={[styles.control, presence.hereNow && styles.controlOn]}
          >
            <Text style={[styles.controlText, presence.hereNow && styles.controlTextOn]}>
              {presence.hereNow ? 'Here now' : "I'm here now"}
            </Text>
          </Pressable>
          <Pressable
            testID="pause-toggle"
            accessibilityRole="switch"
            accessibilityState={{ checked: presence.paused }}
            onPress={() => void presence.setPaused(!presence.paused).catch(() => {})}
            style={styles.control}
          >
            <Text style={styles.controlText}>{presence.paused ? 'Resume' : 'Pause'}</Text>
          </Pressable>
        </View>
      </View>

      {presence.paused ? (
        <Banner
          testID="grid-paused-banner"
          actionTestID="grid-paused-resume"
          tone="warning"
          message="You're paused — no one can see you."
          actionLabel="Resume"
          onAction={onResume}
        />
      ) : null}

      {showReasonBanner && reasonCopy ? (
        <Banner
          testID={`grid-not-visible-${reason}`}
          actionTestID="grid-not-visible-action"
          message={reasonCopy.message}
          actionLabel={reasonCopy.actionLabel}
          busy={verifyBusy && reasonCopy.action === 'verify'}
          onAction={reasonCopy.action ? () => runReasonAction(reasonCopy.action) : undefined}
        />
      ) : null}

      {presence.permission === 'undetermined' ? (
        <Banner
          testID="grid-location-explainer"
          actionTestID="grid-location-explainer-action"
          message={LOCATION_PERMISSION_EXPLAINER}
          actionLabel="Turn on location"
          onAction={onEnableLocation}
        />
      ) : null}
    </View>
  );

  if (isPending) {
    return (
      <View style={styles.center} testID="grid-loading">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.center} testID="grid-error">
        <Text>Something went wrong. Pull to refresh to try again.</Text>
      </View>
    );
  }

  const data = rows ?? [];

  return (
    <FlatList
      testID="grid-list"
      data={data}
      numColumns={2}
      keyExtractor={(row) => row.user_id}
      ListHeaderComponent={header}
      contentContainerStyle={styles.list}
      columnWrapperStyle={data.length > 0 ? styles.column : undefined}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={onRefresh} />}
      ListEmptyComponent={
        <View style={styles.emptyBox}>
          <Text style={styles.empty} testID="grid-empty">
            No one&apos;s around right now — check back later.
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <GridTile
          row={item}
          photoUrl={item.photo_path ? photoUrls?.[item.photo_path] : undefined}
          countyLabel={presence.countyLabel}
          onPress={openProfile}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingBottom: 24 },
  column: { paddingHorizontal: 6 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  title: { fontSize: 20, fontWeight: '700' },
  headerControls: { flexDirection: 'row', gap: 8 },
  control: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#D5D8DD',
  },
  controlOn: { backgroundColor: '#208AEF', borderColor: '#208AEF' },
  controlText: { fontSize: 13, color: '#333' },
  controlTextOn: { color: '#fff', fontWeight: '600' },
  emptyBox: { paddingTop: 64, paddingHorizontal: 24 },
  empty: { color: '#555', textAlign: 'center' },
});
