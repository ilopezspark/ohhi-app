import { StyleSheet, View } from 'react-native';
import { CtaButton } from '../../card/CtaButton';
import { PhotoCarousel } from '../../card/PhotoCarousel';
import { goalLabel } from '../../profile/goalLabels';
import { ProfileTile, type ProfileTileData } from '../../profile/ProfileTile';
import { tintForPhoto } from '../../photos/tint';
import { usePresenceStore } from '../../presence/store';
import { Text } from '../../ui';
import { colors, spacing } from '../../theme/tokens';
import { useProfileEditorDraftContext } from './ProfileEditorDraftContext';
import { useMyPhotos } from './useMyPhotos';

/**
 * `ProfileEditor`'s Preview tab (`docs/design/me-redesign/brief.md`,
 * "ProfileEditor — Preview tab"). Renders through the exact same
 * `ProfileTile` component the grid and `profile/[id].tsx` use — never a
 * copy — fed by the DRAFT status/goals/tags (so an unsaved edit shows up
 * here immediately) plus the caller's REAL photos, tier and here-now (tier/
 * here-now come from `usePresenceStore`, the same client-only store
 * `src/presence/usePresence.ts` writes to; `online` has no self-facing
 * concept anywhere in this app — grid_for_me()'s `is_online` is a read about
 * *other* people, computed server-side from their `last_active_at` — so this
 * treats "previewing your own tile right now" as definitionally online).
 * `disabledActions` renders the say-hi/message footer at 40% opacity,
 * non-interactive, per the brief's "you can't say hi to yourself."
 */
export function PreviewCard() {
  const draftState = useProfileEditorDraftContext();
  const { photos, urls } = useMyPhotos();
  const tier = usePresenceStore((state) => state.tier) ?? 'away';
  const hereNow = usePresenceStore((state) => state.hereNow);

  const userId = draftState.userId;
  const tint = photos[0]?.tint ?? (userId ? tintForPhoto(userId, 0) : colors.avatarTints[0]);

  const tagLabels = draftState.draft.tagIds
    .map((id) => draftState.campusTags.find((tag) => tag.id === id)?.label)
    .filter((label): label is string => !!label);
  const goalLabels = draftState.draft.goals.map(goalLabel);

  const tileData: ProfileTileData = {
    firstName: draftState.firstName,
    gradYear: draftState.gradYear,
    statusLine: draftState.draft.statusLine.trim().length > 0 ? draftState.draft.statusLine : null,
    tier,
    hereNow,
    isOnline: true,
    verified: draftState.verified,
    photoUrl: null,
    tint,
    tagLabels,
    goals: goalLabels,
    campusShort: draftState.campusShort,
  };

  return (
    <View style={styles.wrap} testID="profile-editor-preview">
      <Text variant="helper" color={colors.subtle} style={styles.caption}>
        this is you on the grid right now.
      </Text>
      <View style={styles.tileWrap}>
        <ProfileTile
          size="hero"
          testID="profile-editor-preview-tile"
          data={tileData}
          testIDs={{
            name: 'profile-editor-preview-name',
            statusLine: 'profile-editor-preview-status',
            goals: 'profile-editor-preview-goals',
            tags: 'profile-editor-preview-tags',
            tier: 'profile-editor-preview-tier',
            verified: 'profile-editor-preview-verified',
            hereNow: 'profile-editor-preview-here-now',
          }}
          // ProfileTile's hero variant only renders its top row (and, inside
          // it, the here-now badge) when `topLeft` or `topRight` is truthy —
          // every other hero caller (`profile/[id].tsx`) always supplies a
          // real back button/overflow menu there. Preview has no need for
          // either (the editor's own header is the tab switch), but the
          // artboard (`05-editor-preview.png`) still shows "here now" when
          // applicable, so an empty, invisible spacer keeps that row
          // rendering without adding a control that does anything.
          topRight={<View />}
          disabledActions
          photoSlot={
            userId ? (
              <PhotoCarousel
                style={styles.heroPhoto}
                userId={userId}
                paths={photos.map((photo) => photo.storage_path)}
                urls={urls}
              />
            ) : undefined
          }
          footer={
            <CtaButton
              cta={{ kind: 'hi_and_message' }}
              onHi={() => {}}
              onMessage={() => {}}
              testID="profile-editor-preview-cta"
            />
          }
        />
      </View>
      <Text variant="helper" color={colors.subtle} style={styles.caption}>
        their buttons are greyed out. you can&apos;t say hi to yourself.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: spacing.lgXl },
  caption: { textAlign: 'center' },
  tileWrap: { flex: 1, minHeight: 480 },
  heroPhoto: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, aspectRatio: undefined, borderRadius: 0 },
});
