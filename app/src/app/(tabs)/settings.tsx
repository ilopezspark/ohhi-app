import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { CompletionBar, ScreenHeader, PillButton, RowCard, SectionLabel, SettingsRow, Text } from '../../ui';
import { CheckIcon, EyeIcon, PencilIcon, SettingsIcon } from '../../ui/icons';
import { displayName } from '../../ui/displayName';
import { ProfileTile } from '../../profile/ProfileTile';
import { colors, radii, shadows, spacing } from '../../theme/tokens';
import { useMeData } from '../../me/root/useMeData';

/**
 * `docs/design/me-redesign/brief.md`'s Me screen — the Me tab's root and
 * launchpad (route file stays `(tabs)/settings.tsx` per ruling 11: other
 * screens already link `/settings/...` and the tab bar's own route table
 * expects this exact file, so only its content changes here, not its
 * location). Gear -> `/me/settings`. Editing itself never happens here —
 * `edit profile` opens the profile editor (built concurrently under
 * `app/profile-editor/**`), the status row opens `/quick-status` (same),
 * and the private-card/albums rows push to screens this pass doesn't own
 * either (`/me/private-card`, `/settings/albums`).
 *
 * All data comes from `src/me/root/useMeData.ts`, which refetches on every
 * focus so a change made in one of those other screens shows up here
 * without a manual pull-to-refresh.
 */
export default function MeScreen() {
  const {
    firstName,
    verified,
    identityText,
    photoUrl,
    tint,
    completionPercent,
    nextBestCopy,
    statusLine,
    privateCardShareCount,
    albumCount,
    sharedAlbumCount,
  } = useMeData();

  const hasStatus = !!statusLine && statusLine.trim().length > 0;

  return (
    <View style={styles.safe} testID="me-screen">
      <ScreenHeader
        title="me"
        titleSize={30}
        right={
          <Pressable
            testID="me-settings-gear"
            accessibilityRole="button"
            accessibilityLabel="settings"
            style={styles.gear}
            onPress={() => router.push('/me/settings' as never)}
          >
            <SettingsIcon size={20} />
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.identityRow}>
          <ProfileTile
            testID="me-photo-tile"
            size="thumbnail"
            data={{
              firstName,
              // `thumbnail` never renders `tier` — required by `ProfileTileData` regardless.
              tier: 'away',
              photoUrl,
              tint,
            }}
          />
          <View style={styles.identityCol}>
            <View style={styles.nameRow}>
              <Text variant="display" numberOfLines={1} style={styles.name} testID="me-name">
                {displayName(firstName)}
              </Text>
              {verified ? (
                <View style={styles.verifiedBadge} accessibilityLabel="verified student" testID="me-verified-check">
                  <CheckIcon size={13} color={colors.ink} />
                </View>
              ) : null}
            </View>
            {identityText ? (
              <Text variant="bodyMedium" color={colors.inkSoft} testID="me-identity-line">
                {identityText}
              </Text>
            ) : null}
            <Pressable
              testID="me-edit-profile"
              accessibilityRole="button"
              accessibilityLabel="edit profile"
              style={styles.editPill}
              onPress={() => router.push('/profile-editor' as never)}
            >
              <PencilIcon size={14} color={colors.onDark} />
              <Text variant="labelLg" color={colors.onDark}>
                edit profile
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.completionBlock}>
          <CompletionBar testID="me-completion" percent={completionPercent} />
          {completionPercent < 100 && nextBestCopy ? (
            <Text variant="micro" color={colors.inkSoft} testID="me-next-best">
              {nextBestCopy}
            </Text>
          ) : null}
        </View>

        <PillButton
          testID="me-preview"
          label="see how you look on the grid"
          icon={<EyeIcon size={16} color={colors.ink} />}
          onPress={() => router.push('/profile-editor?tab=preview' as never)}
        />

        <View style={styles.section}>
          <SectionLabel label="status" />
          <RowCard style={styles.cardPadding}>
            <Pressable
              testID="me-status-row"
              accessibilityRole="button"
              accessibilityLabel={hasStatus ? statusLine! : 'add a status'}
              onPress={() => router.push('/quick-status' as never)}
              style={styles.statusRow}
            >
              <Text
                variant="bodyMedium"
                color={hasStatus ? colors.ink : colors.inkSoft}
                style={styles.statusText}
                numberOfLines={2}
              >
                {hasStatus ? statusLine : 'add a status'}
              </Text>
              <PencilIcon size={16} color={colors.inkSoft} />
            </Pressable>
          </RowCard>
        </View>

        <View style={styles.section}>
          <SectionLabel label="only for people you choose" />
          <RowCard style={styles.cardPadding}>
            <SettingsRow
              testID="me-row-private-card"
              icon="lock"
              title="private card"
              subtitle={shareCountLabel(privateCardShareCount)}
              accessory={{ kind: 'chevron' }}
              onPress={() => router.push('/me/private-card' as never)}
            />
            <SettingsRow
              testID="me-row-albums"
              icon="image"
              title="albums"
              subtitle={albumsLabel(albumCount, sharedAlbumCount)}
              accessory={{ kind: 'chevron' }}
              onPress={() => router.push('/settings/albums' as never)}
            />
          </RowCard>
        </View>
      </ScrollView>
    </View>
  );
}

function shareCountLabel(count: number): string {
  if (count === 0) return 'not shared with anyone';
  return `shared with ${count} ${count === 1 ? 'person' : 'people'}`;
}

function albumsLabel(albumCount: number, sharedAlbumCount: number): string {
  return `${albumCount} album${albumCount === 1 ? '' : 's'} · ${sharedAlbumCount} shared`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  scroll: { paddingHorizontal: spacing.lgXl, paddingTop: spacing.xl, paddingBottom: spacing.huge, gap: spacing.xl },
  gear: {
    width: 40,
    height: 40,
    borderRadius: radii.circle,
    backgroundColor: colors.paperRaised,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.float,
  },
  identityRow: { flexDirection: 'row', gap: spacing.lgXl, alignItems: 'flex-start' },
  identityCol: { flex: 1, gap: spacing.xs, paddingTop: spacing.xs },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.smMd },
  name: { flexShrink: 1 },
  verifiedBadge: {
    width: 26,
    height: 26,
    borderRadius: radii.circle,
    backgroundColor: colors.sage,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    marginTop: spacing.xs,
    backgroundColor: colors.ink,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lgXl,
    paddingVertical: spacing.smMd,
  },
  completionBlock: { gap: spacing.smMd },
  section: { gap: spacing.smMd },
  cardPadding: { paddingHorizontal: spacing.lgXl },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.mdLg,
    paddingVertical: spacing.lgXl,
  },
  statusText: { flex: 1 },
});
