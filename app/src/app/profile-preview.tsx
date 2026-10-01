import { useState } from 'react';
import { FALLBACK, goBack } from '../routing/goBack';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { getMyIdentity } from '../api/identity';
import { CtaButton } from '../card/CtaButton';
import { getPreviewDraft, previewSourceOf, type PreviewSource } from '../me/editor/previewDraft';
import { buildPreviewData } from '../me/editor/previewData';
import { previewPhotos } from '../me/editor/photoStates';
import { useMyPhotos } from '../me/editor/useMyPhotos';
import { useProfileEditorDraft } from '../me/editor/useProfileEditorDraft';
import { usePresenceStore } from '../presence/store';
import { ProfileView } from '../profile/view/ProfileView';
import { ScreenHeader, Text } from '../ui';
import { colors, spacing } from '../theme/tokens';

/**
 * Your own profile, exactly as another person sees it (owner ruling: "the
 * preview screen should be the actual profile view screen, going back just
 * brings them back where they came from"). The same full-screen `ProfileView`
 * as `profile/[id].tsx` (hero bleed, insets, back button on the photo, detail
 * list), in `preview` mode: the say-hi/message bar is shown greyed out and
 * untouchable ("you can't say hi to yourself"), there is no report/block, and
 * gated content is shown with its note.
 *
 * It is a plain push from Me's "see how you look on the grid" pill and from
 * the editor's `preview` action, and back is `goBack` (the Me tab when there is no history), so the
 * person returns to whichever of the two they came from.
 *
 * Data (`me/editor/previewData.ts`): the saved profile
 * (`useProfileEditorDraft`, which reads `my_profile_fields()` and the other
 * own-row reads; never `profile_card_for`), or, when opened from the editor
 * with `?from=editor`, the editor's draft as handed over by
 * `me/editor/previewDraft.ts`, so an unsaved edit shows at once. Tier and
 * here-now are live from the presence store. The public cards (identity,
 * background, lifestyle, when i'm around, before you message me) come from
 * `getMyIdentity()`, the owner's read: every card they filled, whatever its
 * audience, each one not shown to everyone marked with its note. That read
 * never blocks the preview: loading or failed, the cards are just left out.
 */

/** Own query key: `queryKeys.me.about` holds a different shape (`me/card/summary.ts`). */
export const MY_IDENTITY_CARDS_KEY = ['me', 'identity_cards'] as const;
export default function ProfilePreviewScreen() {
  const params = useLocalSearchParams<{ from?: string | string[] }>();
  const from = Array.isArray(params.from) ? params.from[0] : params.from;

  const saved = useProfileEditorDraft();
  // Read once on open: the draft as it was when `preview` was pressed.
  const [handedOver] = useState<PreviewSource | null>(() => (from === 'editor' ? getPreviewDraft() : null));
  const source = handedOver ?? (saved.ready ? previewSourceOf(saved) : null);

  const { photos, urls } = useMyPhotos({ variant: 'full' });
  const tier = usePresenceStore((state) => state.tier) ?? 'away';
  const hereNow = usePresenceStore((state) => state.hereNow);
  const identityQuery = useQuery({ queryKey: MY_IDENTITY_CARDS_KEY, queryFn: getMyIdentity, retry: false });

  if (!source) {
    return (
      <View style={styles.plain} testID="profile-preview-screen">
        <ScreenHeader testID="profile-preview-header" onBack={() => goBack(FALLBACK.me)} />
        {saved.loading ? (
          <View style={styles.center} testID="profile-preview-loading">
            <ActivityIndicator size="large" color={colors.ink} />
          </View>
        ) : (
          <View style={styles.center} testID="profile-preview-load-failed">
            <Text variant="body" color={colors.inkSoft} style={styles.centerText}>
              {saved.loadError ?? "that didn't load. try again."}
            </Text>
            <Pressable testID="profile-preview-retry" accessibilityRole="button" onPress={saved.retry} style={styles.retry}>
              <Text variant="labelLg" color={colors.signal}>
                try again
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  const shownPhotos = previewPhotos(photos);
  const data = buildPreviewData({
    userId: source.userId,
    firstName: source.firstName,
    gradYear: source.gradYear,
    verified: source.verified,
    campusShort: source.campusShort,
    catalog: source.catalog,
    draft: source.draft,
    fieldsMeta: source.fieldsMeta ?? null,
    // Every photo the owner has, pending ones included and badged "under
    // review" (owner ruling); a removed one is left out.
    photoPaths: shownPhotos.paths,
    photoUrls: urls,
    photoBadges: shownPhotos.badges,
    tier,
    hereNow,
    identity: identityQuery.data ?? null,
  });

  return (
    <View style={styles.container} testID="profile-preview-screen">
      <ProfileView
        data={data}
        preview
        onBack={() => goBack(FALLBACK.me)}
        testIDPrefix="profile-preview"
        renderActions={({ onPaper }) => (
          <CtaButton
            cta={{ kind: 'hi_and_message' }}
            appearance={onPaper ? 'paper' : 'photo'}
            style={styles.cta}
            onHi={() => {}}
            onMessage={() => {}}
            testID="profile-preview-cta"
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  plain: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lgXl, padding: spacing.xxl },
  centerText: { textAlign: 'center' },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.lgXl },
  cta: { marginTop: 0 },
});
