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
import { VerifySheet } from '../../grid/VerifySheet';
import { notVisibleReason, REASON_COPY } from '../../grid/visibility';
import { LOCATION_PERMISSION_EXPLAINER, usePresence, usePresenceStore } from '../../presence';
import { getRealtimeManager, type HereNowEvent } from '../../realtime';
import { BellIcon, EmptyState, SearchIcon, Text } from '../../ui';
import { colors, radii, shadows, spacing } from '../../theme/tokens';

/**
 * The grid (`Grid.html`/`Grid-Empty.html`/`Grid-Verify.html`,
 * `docs/design/system.md`; behaviour from `docs/app-onboarding-grid-plan.md`
 * §3–§5).
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
 *
 * Deviations from the design, see `app/README.md`'s "Grid and profile
 * design" section for the full list: the roam pill's "change" action and the
 * header bell are both non-functional (no campus switching, no notifications
 * feed exist in this app); the here-now/pause toggles have no home in the
 * design's `Grid.html` at all (that pair lives on `Me.html` conceptually)
 * but are kept here, restyled, since removing them would drop real behaviour
 * the brief requires keeping.
 */
export default function GridScreen() {
  const queryClient = useQueryClient();
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifySheetOpen, setVerifySheetOpen] = useState(false);

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
      // Generic by design (decision 24) — the sheet just stops spinning and
      // the user can try again. Never surface why.
    } finally {
      setVerifyBusy(false);
      // The result arrives via the provider's server-to-server webhook, so
      // re-read `me()` on dismiss rather than trusting a redirect.
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    }
  }, [queryClient]);

  const onVerifySheetConfirm = useCallback(async () => {
    await onVerify();
    setVerifySheetOpen(false);
  }, [onVerify]);

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
      // The design (`Grid-Verify.html`) replaces the old direct-to-Persona
      // jump with an in-app sheet that offers a real "just look around for
      // now" dismissal — something the old single-button banner never had.
      if (action === 'verify') setVerifySheetOpen(true);
      if (action === 'enable_location') void onEnableLocation();
      if (action === 'resume') void onResume();
    },
    [onEnableLocation, onResume]
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

  const data = rows ?? [];
  const visibleCount = data[0]?.visible_count ?? data.length;
  const hereNowCount = data[0]?.here_now_count ?? data.filter((row) => row.here_now).length;

  const header = (
    <View>
      <View style={styles.topRow}>
        <Text variant="wordmark">ohhi</Text>
        <Pressable
          testID="grid-bell"
          accessibilityRole="button"
          accessibilityLabel="Notifications"
          style={[styles.iconButton, shadows.sm]}
        >
          <BellIcon size={20} color={colors.ink} />
        </Pressable>
      </View>

      {/* No campus-switching feature exists — "change" is decorative, matching the
          brief ("wire `change` to nothing or the campus label only"). */}
      <Pressable
        testID="grid-roam-pill"
        accessibilityRole="button"
        accessibilityLabel="Your grid, by campus"
        style={[styles.roamPill, shadows.sm]}
      >
        <SearchIcon size={18} color={colors.ink} />
        <View style={styles.roamText}>
          <Text variant="captionMuted" color={colors.subtle}>
            your grid is from
          </Text>
          <Text variant="rowLabel">
            {meData?.campus_label ?? 'your campus'}
            {meData?.campus_slug ? (
              <Text variant="rowLabel" color={colors.subtle}>{`  ·  ${meData.campus_slug.toUpperCase()}`}</Text>
            ) : null}
          </Text>
        </View>
        <Text variant="caption" color={colors.signal}>
          change
        </Text>
      </Pressable>

      <View style={styles.countRow}>
        <Text variant="title">
          {visibleCount} people around,{' '}
          <Text variant="title" color={colors.signal}>
            {hereNowCount} here right now
          </Text>
        </Text>
        <Text variant="captionMuted" color={colors.subtle}>
          closest first
        </Text>
      </View>

      <View style={styles.utilityRow}>
        <Pressable
          testID="here-now-toggle"
          accessibilityRole="switch"
          accessibilityState={{ checked: presence.hereNow }}
          onPress={() => void presence.setHereNow(!presence.hereNow).catch(() => {})}
          style={[styles.utilityChip, shadows.sm, presence.hereNow && styles.utilityChipOn]}
        >
          <Text variant="caption" color={presence.hereNow ? colors.onDark : colors.muted}>
            {presence.hereNow ? 'Here now' : "I'm here now"}
          </Text>
        </Pressable>
        <Pressable
          testID="pause-toggle"
          accessibilityRole="switch"
          accessibilityState={{ checked: presence.paused }}
          onPress={() => void presence.setPaused(!presence.paused).catch(() => {})}
          style={[styles.utilityChip, shadows.sm]}
        >
          <Text variant="caption" color={colors.muted}>
            {presence.paused ? 'Resume' : 'Pause'}
          </Text>
        </Pressable>
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
          busy={verifyBusy && reasonCopy.action === 'verify' && verifySheetOpen}
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
        <ActivityIndicator size="large" color={colors.ink} />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.center} testID="grid-error">
        <Text variant="body">Something went wrong. Pull to refresh to try again.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <FlatList
        testID="grid-list"
        data={data}
        numColumns={2}
        keyExtractor={(row) => row.user_id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <EmptyState
            testID="grid-empty"
            title="quiet right now."
            message="check back after class. we'll nudge you when someone new shows up — turn that on."
            icon={
              <View style={styles.emptyIcon}>
                <SearchIcon size={36} color={colors.subtle} />
              </View>
            }
          />
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

      <VerifySheet
        visible={verifySheetOpen}
        busy={verifyBusy}
        onVerify={onVerifySheetConfirm}
        onDismiss={() => setVerifySheetOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },
  list: { paddingHorizontal: spacing.smMd, paddingBottom: spacing.xxl },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.xxl,
    paddingHorizontal: spacing.smMd,
    marginBottom: spacing.lg,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: radii.circle,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roamPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    paddingVertical: spacing.mdLg,
    paddingHorizontal: spacing.lgXl,
    marginHorizontal: spacing.smMd,
    marginBottom: spacing.lg,
  },
  roamText: { flex: 1, gap: 1 },
  countRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: spacing.smMd,
    marginBottom: spacing.smMd,
  },
  utilityRow: {
    flexDirection: 'row',
    gap: spacing.smMd,
    paddingHorizontal: spacing.smMd,
    marginBottom: spacing.smMd,
  },
  utilityChip: {
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.mdLg,
    paddingVertical: spacing.smMd,
  },
  utilityChipOn: { backgroundColor: colors.ink },
  emptyIcon: {
    width: 96,
    height: 96,
    borderRadius: radii.circle,
    backgroundColor: colors.tint,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.85,
  },
});
