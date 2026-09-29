import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove, type NavigationAction } from 'expo-router/react-navigation';
import { EditSections } from '../../me/editor/EditSections';
import { PreviewCard } from '../../me/editor/PreviewCard';
import { useProfileEditorDraftContext } from '../../me/editor/ProfileEditorDraftContext';
import { Text } from '../../ui';
import { colors, spacing } from '../../theme/tokens';

type EditorTab = 'edit' | 'preview';

/**
 * `ProfileEditor` — `Edit`/`Preview` tab switch
 * (`docs/design/me-redesign/brief.md`). `?tab=preview` opens straight onto
 * Preview (Me's "see how you look on the grid" pill uses this). `cancel`
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
  const initialTabParam = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const [tab, setTab] = useState<EditorTab>(initialTabParam === 'preview' ? 'preview' : 'edit');

  const draftState = useProfileEditorDraftContext();
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
    else router.back();
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

  async function handleDone() {
    const ok = await draftState.commit();
    if (ok) leave();
  }

  if (draftState.loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']} testID="profile-editor-loading">
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.ink} />
        </View>
      </SafeAreaView>
    );
  }

  if (!draftState.ready) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']} testID="profile-editor-load-failed">
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
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="profile-editor-screen">
      <View style={styles.header}>
        <Pressable testID="profile-editor-cancel" accessibilityRole="button" onPress={requestClose} hitSlop={8}>
          <Text variant="labelLg" color={colors.muted}>
            cancel
          </Text>
        </Pressable>
        <Text variant="title" numberOfLines={1} style={styles.headerName}>
          {draftState.firstName}
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

      <View style={styles.tabRow}>
        <TabButton testID="profile-editor-tab-edit" label="edit" active={tab === 'edit'} onPress={() => setTab('edit')} />
        <TabButton
          testID="profile-editor-tab-preview"
          label="preview"
          active={tab === 'preview'}
          onPress={() => setTab('preview')}
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

      {tab === 'edit' ? (
        <ScrollView contentContainerStyle={styles.scroll} testID="profile-editor-edit-scroll">
          <EditSections />
        </ScrollView>
      ) : (
        <View style={styles.previewWrap} testID="profile-editor-preview-wrap">
          <PreviewCard />
        </View>
      )}
    </SafeAreaView>
  );
}

function TabButton({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={styles.tabButton}
    >
      <Text variant="bodyStrong" color={active ? colors.ink : colors.inkFaint}>
        {label}
      </Text>
      <View style={[styles.tabUnderline, active && styles.tabUnderlineActive]} />
    </Pressable>
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
    paddingVertical: spacing.lgXl,
  },
  headerName: { flex: 1, textAlign: 'center' },
  tabRow: { flexDirection: 'row', paddingHorizontal: spacing.lgXl, borderBottomWidth: 1, borderBottomColor: colors.line },
  tabButton: { flex: 1, alignItems: 'center', paddingBottom: spacing.mdLg, gap: spacing.smMd },
  tabUnderline: { height: 2, width: '100%', backgroundColor: 'transparent' },
  tabUnderlineActive: { backgroundColor: colors.ink },
  doneError: { paddingHorizontal: spacing.lgXl, paddingTop: spacing.smMd },
  scroll: { padding: spacing.lgXl, paddingBottom: spacing.huge },
  previewWrap: { flex: 1, padding: spacing.lgXl },
});
