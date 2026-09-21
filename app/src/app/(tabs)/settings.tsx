import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { me as fetchMe } from '../../api/me';
import { getMyPresence, setHereNow } from '../../api/presence';
import { listMyPhotos, signedPhotoUrls } from '../../api/photos';
import { listMyAlbums } from '../../api/albums';
import { getMyCard } from '../../api/identityWrite';
import { getIdentity } from '../../api/identity';
import { getFirstName, getStatusLine, updateProfile } from '../../api/profile';
import { tintForPhoto } from '../../photos/tint';
import { usePresenceStore } from '../../presence/store';
import { Badge, Header, Input, ListRow, Surface, Text, Toggle } from '../../ui';
import { SettingsIcon } from '../../ui/icons';
import { PhotoTile } from '../../settings/components/PhotoTile';
import { colors, spacing } from '../../theme/tokens';

const VERIFICATION_COPY: Record<string, string> = {
  unverified: 'get verified',
  email_verified: 'finish verifying',
  id_pending: 'in progress',
  manual_review: 'in progress',
  verified: 'verified',
  id_failed: 'try again',
};

/**
 * `(tabs)/settings.tsx` renders `Me.html` — the "me" tab's own landing
 * screen (confusingly named: the file/route is still `settings.tsx` so
 * nothing that links `/(tabs)/settings` (this screen's own
 * `settings/block/[id].tsx`) breaks — see `docs/design/system.md`'s
 * screen->route map and the task brief). The gear button routes to
 * `/settings/menu`, this pass's new home for `Settings.html`'s content
 * (pause/here-now/notifications/blocked/sign-out/delete — see that file's
 * own doc comment for why those live there instead of a second copy here).
 *
 * "here now" is still a real, wired toggle on this screen (as in the
 * mockup's own status card) even though it also appears in `/settings/menu`
 * — both read/write the same `usePresenceStore`/`set_here_now` RPC, so they
 * can never drift out of sync; "pause my grid" is a plain navigational row
 * here (matching the mockup's row styling) rather than a second toggle,
 * since decision-time this build put the actual pause switch in
 * `/settings/menu` only.
 */
export default function MeScreen() {
  const queryClient = useQueryClient();

  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: fetchMe });
  const { data: myPresence } = useQuery({ queryKey: ['my_presence'], queryFn: getMyPresence });
  const { data: myPhotos } = useQuery({ queryKey: ['my_photos'], queryFn: listMyPhotos });
  const { data: albums } = useQuery({ queryKey: ['my_albums'], queryFn: listMyAlbums });
  const { data: firstName } = useQuery({ queryKey: ['my_first_name'], queryFn: getFirstName });
  const { data: statusLine } = useQuery({ queryKey: ['my_status_line'], queryFn: getStatusLine });
  const { data: card } = useQuery({ queryKey: ['my_card'], queryFn: getMyCard });
  const { data: identity } = useQuery({
    queryKey: ['my_identity', meData?.id],
    queryFn: () => getIdentity(meData!.id),
    enabled: !!meData?.id,
  });

  const hereNow = usePresenceStore((s) => s.hereNow);

  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || meData === undefined) return;
    seeded.current = true;
    usePresenceStore.getState().setHereNow(!!meData?.here_now);
  }, [meData]);

  const [status, setStatus] = useState('');
  const statusSeeded = useRef(false);
  useEffect(() => {
    if (statusSeeded.current || statusLine === undefined) return;
    statusSeeded.current = true;
    setStatus(statusLine ?? '');
  }, [statusLine]);

  const mainPhoto = myPhotos?.find((photo) => photo.position === 0) ?? null;
  const { data: photoUrls } = useQuery({
    queryKey: ['my_photo_urls', mainPhoto?.storage_path],
    queryFn: () => signedPhotoUrls([mainPhoto!.storage_path]),
    enabled: !!mainPhoto,
  });
  const mainPhotoUrl = mainPhoto ? photoUrls?.[mainPhoto.storage_path] : undefined;
  const tint = meData ? tintForPhoto(meData.id, 0) : colors.avatarTints[0];

  async function onToggleHereNow(next: boolean) {
    usePresenceStore.getState().setHereNow(next);
    try {
      await setHereNow(next);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    } catch {
      usePresenceStore.getState().setHereNow(!next);
    }
  }

  async function onStatusBlur() {
    const trimmed = status.trim();
    if (trimmed === (statusLine ?? '')) return;
    try {
      await updateProfile({ status_line: trimmed.length > 0 ? trimmed : null });
      void queryClient.invalidateQueries({ queryKey: ['my_status_line'] });
    } catch {
      // Best-effort — the field keeps whatever the user typed either way.
    }
  }

  const filledCount = useMemo(() => {
    let n = 0;
    if (card) n += (['into', 'safer_sex', 'kinks', 'hard_nos'] as const).filter((f) => card[f]?.length > 0).length;
    if (identity?.pronouns) n += 1;
    if (identity?.orientation?.length) n += 1;
    return n;
  }, [card, identity]);

  const verificationStatus = meData?.verification_status ?? null;
  const verificationCopy = verificationStatus ? VERIFICATION_COPY[verificationStatus] : null;
  const verified = verificationStatus === 'verified';

  const campusText = meData ? [meData.campus_slug?.toUpperCase(), meData.campus_label].filter(Boolean).join(' · ') : '';

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="me-screen">
      <ScrollView contentContainerStyle={styles.scroll}>
        <Header
          title="me"
          titleSize={32}
          right={
            <Pressable
              testID="me-settings-gear"
              accessibilityRole="button"
              accessibilityLabel="Settings"
              style={styles.gear}
              onPress={() => router.push('/settings/menu' as never)}
            >
              <SettingsIcon size={20} />
            </Pressable>
          }
        />

        <View style={styles.heroRow}>
          <PhotoTile
            testID="me-photo-tile"
            uri={mainPhotoUrl}
            tint={tint}
            pending={mainPhoto?.moderation_state === 'pending'}
            hereNow={hereNow}
            name={firstName ?? 'you'}
            subtitle={campusText || undefined}
          />
          <View style={styles.heroSide}>
            <Surface radius="lg" shadow="xs" padding="lg" style={styles.hereNowCard}>
              <View style={styles.hereNowRow}>
                <Text variant="rowLabel">here now</Text>
                <Toggle testID="me-here-now-toggle" value={hereNow} onValueChange={onToggleHereNow} />
              </View>
              <Text variant="helper" style={styles.hereNowHelper}>
                turns off by itself after 2 hours quiet
              </Text>
            </Surface>
            {/*
              Deviation: `Me.html`'s "edit photos & tags" chip has no app
              route yet — post-onboarding photo/tag re-editing isn't built
              anywhere in this codebase (`(onboarding)/photo.tsx` and
              `tags.tsx` are onboarding-only steps, read-only for this pass
              and out of scope to turn into a settings flow here). Rendered
              disabled rather than invented or silently dropped.
            */}
            <Pressable testID="me-edit-photos" style={styles.editPhotosChip} disabled>
              <Text variant="caption" color={colors.ink}>
                edit photos &amp; tags
              </Text>
            </Pressable>
            <Text variant="helper" style={styles.gridHelper}>
              this is how you look on the grid
            </Text>
          </View>
        </View>

        <Input
          testID="me-status"
          label="status"
          multiline
          value={status}
          onChangeText={setStatus}
          onBlur={onStatusBlur}
        />

        <View>
          <ListRow
            testID="me-row-albums"
            title="albums"
            helper={`${albums?.length ?? 0} · private`}
            onPress={() => router.push('/settings/albums' as never)}
          />
          <ListRow
            testID="me-row-more-about-me"
            title="more about me"
            helper={`private card · ${filledCount} of 6 filled`}
            onPress={() => router.push('/settings/card' as never)}
          />
          <ListRow testID="me-row-campus" title="my campus" helper={campusText} />
          <ListRow
            testID="me-row-verification"
            title="verification"
            right={
              <Badge
                label={verificationCopy ?? ''}
                tone={verified ? 'success' : 'neutral'}
              />
            }
            onPress={verified ? undefined : () => router.push('/settings/menu' as never)}
          />
          <ListRow
            testID="me-row-pause"
            title="pause my grid"
            helper="hide me, keep my chats"
            last
            onPress={() => router.push('/settings/menu' as never)}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  scroll: { paddingHorizontal: spacing.lgXl, paddingBottom: spacing.huge, gap: spacing.xl },
  gear: {
    width: 40,
    height: 40,
    borderRadius: 9999,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroRow: { flexDirection: 'row', gap: spacing.lg, alignItems: 'stretch' },
  heroSide: { flex: 1, gap: spacing.md, justifyContent: 'flex-start' },
  hereNowCard: { gap: spacing.smMd },
  hereNowRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hereNowHelper: { fontSize: 11 },
  editPhotosChip: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: 9999,
    paddingVertical: spacing.smMd,
    opacity: 0.6,
  },
  gridHelper: { fontSize: 12, textAlign: 'center' },
});
