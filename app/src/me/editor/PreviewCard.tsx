import { StyleSheet, View } from 'react-native';
import { CtaButton } from '../../card/CtaButton';
import { ProfileView } from '../../profile/view/ProfileView';
import { usePresenceStore } from '../../presence/store';
import { Text } from '../../ui';
import { colors, radii, spacing } from '../../theme/tokens';
import { buildPreviewData } from './previewData';
import { useProfileEditorDraftContext } from './ProfileEditorDraftContext';
import { useMyPhotos } from './useMyPhotos';

/**
 * `ProfileEditor`'s Preview tab. Renders the full profile through the same
 * `ProfileView` the profile screen uses (`profile/[id].tsx`), in `preview`
 * mode: the say-hi/message bar at 40% and untouchable ("you can't say hi to
 * yourself"), no report/block, and gated content shown with its note. The
 * data is the DRAFT plus `my_profile_fields()` (`previewData.ts`), so an
 * unsaved edit shows here at once; tier and here-now are live from
 * `usePresenceStore`.
 */
export function PreviewCard() {
  const draftState = useProfileEditorDraftContext();
  const { photos, urls } = useMyPhotos();
  const tier = usePresenceStore((state) => state.tier) ?? 'away';
  const hereNow = usePresenceStore((state) => state.hereNow);

  const data = buildPreviewData({
    userId: draftState.userId,
    firstName: draftState.firstName,
    gradYear: draftState.gradYear,
    verified: draftState.verified,
    campusShort: draftState.campusShort,
    catalog: draftState.catalog,
    draft: draftState.draft,
    fieldsMeta: draftState.fieldsMeta ?? null,
    photoPaths: photos.map((photo) => photo.storage_path),
    photoUrls: urls,
    tier,
    hereNow,
  });

  return (
    <View style={styles.wrap} testID="profile-editor-preview">
      <Text variant="helper" color={colors.subtle} style={styles.caption}>
        this is your profile as people on campus see it.
      </Text>
      <View style={styles.frame}>
        <ProfileView
          data={data}
          preview
          testIDPrefix="profile-editor-preview"
          renderActions={({ onPaper }) => (
            <CtaButton
              cta={{ kind: 'hi_and_message' }}
              appearance={onPaper ? 'paper' : 'photo'}
              onHi={() => {}}
              onMessage={() => {}}
              testID="profile-editor-preview-cta"
            />
          )}
        />
      </View>
      <Text variant="helper" color={colors.subtle} style={styles.caption}>
        the buttons are greyed out. you can&apos;t say hi to yourself.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: spacing.mdLg },
  caption: { textAlign: 'center' },
  frame: { flex: 1, minHeight: 480, borderRadius: radii.hero, overflow: 'hidden', backgroundColor: colors.paper },
});
