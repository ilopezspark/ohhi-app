import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Redirect, router, useLocalSearchParams, useNavigation } from 'expo-router';
import { FALLBACK, goBack } from '../../routing/goBack';
import { usePreventRemove, type NavigationAction } from 'expo-router/react-navigation';
import { EditSections } from '../../me/editor/EditSections';
import { useProfileEditorDraftContext } from '../../me/editor/ProfileEditorDraftContext';
import { previewSourceOf, setPreviewDraft } from '../../me/editor/previewDraft';
import { PillButton, Text, useHeaderInsets } from '../../ui';
import { EyeIcon } from '../../ui/icons';
import { displayName } from '../../ui/displayName';
import { colors, spacing } from '../../theme/tokens';
import { HEADER_TOP_GAP } from '../../ui/screenInsets';
import { footerBottomPadding } from '../../ui/keyboardInset';

/**
 * `ProfileEditor` — one edit screen (`docs/design/me-redesign/brief.md`).
 * `preview` pushes `/profile-preview?from=editor`, your profile as others
 * see it (the real profile screen), showing this draft, unsaved edits
 * included; back from there returns here. `?tab=preview` is an old link:
 * it redirects to `/profile-preview`. `cancel`
 * discards the shared draft (`ProfileEditorDraftContext`, provided by
 * `_layout.tsx`) and asks for confirmation first if it's dirty, matching the
 * private-card editor's own `Alert.alert` confirm pattern
 * (`profile-editor/private-card.tsx`) rather than inventing a second one.
 * `done` commits every changed field in one batch — see
 * `useProfileEditorDraft#commit`'s own doc comment for the exact
 * all-or-report semantics.
 *
 * "Warn on dismiss if dirty" covers every way out, not just `cancel`:
 * `usePreventRemove` intercepts the modal's swipe-down and the Android back
 * button while the draft is dirty and asks the same question `cancel` does.
 */
export default function ProfileEditorScreen() {
  const params = useLocalSearchParams<{ tab?: string | string[] }>();
  const tabParam = Array.isArray(params.tab) ? params.tab[0] : params.tab;

  const draftState = useProfileEditorDraftContext();
  // The Me screen's heading padding (owner ruling), shared with every screen.
  const insets = useHeaderInsets();
  const navigation = useNavigation();
  // A deliberate exit (a successful `done`, a clean `cancel`, a confirmed
  // discard). Held in state, not acted on inline, so the dismiss guard below
  // has re-rendered as "allowed" before the navigation actually happens —
  // otherwise the guard would catch our own exit and ask again.
  const [exit, setExit] = useState<{ action: NavigationAction | null } | null>(null);

  usePreventRemove(draftState.dirty && exit === null, ({ data }) => {
    confirmDiscard(data.action);
  });

  useEffect(() => {
    if (!exit) return;
    if (exit.action) navigation.dispatch(exit.action);
    else goBack(FALLBACK.me);
  }, [exit, navigation]);

  /** `action` is the blocked navigation to replay (a swipe-down, a hardware back); `null` means a plain back. */
  function confirmDiscard(action: NavigationAction | null) {
    Alert.alert('discard changes?', 'you have unsaved edits. leaving now discards them.', [
      { text: 'keep editing', style: 'cancel' },
      {
        text: 'discard',
        style: 'destructive',
        onPress: () => {
          draftState.discard();
          setExit({ action });
        },
      },
    ]);
  }

  function leave() {
    setExit({ action: null });
  }

  function requestClose() {
    if (draftState.dirty) confirmDiscard(null);
    else leave();
  }

  function openPreview() {
    setPreviewDraft(previewSourceOf(draftState));
    router.push('/profile-preview?from=editor' as never);
  }

  async function handleDone() {
    const ok = await draftState.commit();
    if (ok) leave();
  }

  // An old `?tab=preview` link: the preview is its own screen now.
  if (tabParam === 'preview') return <Redirect href={'/profile-preview' as never} />;

  if (draftState.loading) {
    return (
      <View style={[styles.safe, { paddingTop: insets.statusBar }]} testID="profile-editor-loading">
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.ink} />
        </View>
      </View>
    );
  }

  if (!draftState.ready) {
    return (
      <View style={[styles.safe, { paddingTop: insets.statusBar }]} testID="profile-editor-load-failed">
        <View style={styles.header}>
          <Pressable testID="profile-editor-cancel" accessibilityRole="button" onPress={leave} hitSlop={8}>
            <Text variant="labelLg" color={colors.muted}>
              cancel
            </Text>
          </Pressable>
        </View>
        <View style={styles.center}>
          <Text variant="body" color={colors.inkSoft} testID="profile-editor-load-error">
            {draftState.loadError ?? "that didn't load. try again."}
          </Text>
          <Pressable
            testID="profile-editor-retry"
            accessibilityRole="button"
            onPress={draftState.retry}
            style={styles.retry}
          >
            <Text variant="labelLg" color={colors.signal}>
              try again
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.safe, { paddingTop: insets.statusBar }]} testID="profile-editor-screen">
      <View style={styles.header}>
        <Pressable testID="profile-editor-cancel" accessibilityRole="button" onPress={requestClose} hitSlop={8}>
          <Text variant="labelLg" color={colors.muted}>
            cancel
          </Text>
        </Pressable>
        <Text variant="title" numberOfLines={1} style={styles.headerName}>
          {displayName(draftState.firstName)}
        </Text>
        <Pressable
          testID="profile-editor-done"
          accessibilityRole="button"
          disabled={draftState.saving}
          onPress={handleDone}
          hitSlop={8}
        >
          <Text variant="labelLg" color={draftState.saving ? colors.inkDisabled : colors.signal}>
            done
          </Text>
        </Pressable>
      </View>

      <View style={styles.previewRow}>
        <PillButton
          testID="profile-editor-preview"
          label="preview"
          icon={<EyeIcon size={16} color={colors.ink} />}
          onPress={openPreview}
        />
      </View>

      {draftState.saveError ? (
        <Text variant="helper" color={colors.danger} testID="profile-editor-done-error" style={styles.doneError}>
          {draftState.saveError}
        </Text>
      ) : null}
      {draftState.loadError ? (
        <Text variant="helper" color={colors.danger} testID="profile-editor-load-error" style={styles.doneError}>
          {draftState.loadError}
        </Text>
      ) : null}

      <ScrollView
        // The end clears the home indicator / navigation bar (the shared bar rule).
        contentContainerStyle={[styles.scroll, { paddingBottom: footerBottomPadding(insets.bottom, { edge: spacing.huge }) }]}
        testID="profile-editor-edit-scroll"
      >
        <EditSections />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lgXl, padding: spacing.xxl },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.lgXl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lgXl,
    // Under the status bar: the shared 12 gap (`ui/screenInsets.ts`), then the row.
    paddingTop: HEADER_TOP_GAP,
    paddingBottom: spacing.lgXl,
  },
  headerName: { flex: 1, textAlign: 'center' },
  previewRow: { paddingHorizontal: spacing.lgXl, paddingBottom: spacing.lgXl },
  doneError: { paddingHorizontal: spacing.lgXl, paddingTop: spacing.smMd },
  scroll: { padding: spacing.lgXl },
});
