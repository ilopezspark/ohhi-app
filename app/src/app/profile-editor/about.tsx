import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getIdentity } from '../../api/identity';
import { putIdentity } from '../../api/identityWrite';
import { mapSupabaseError } from '../../api/errors';
import { supabase } from '../../api/client';
import { currentUserId } from '../../api/session';
import { queryKeys } from '../../me/queryKeys';
import {
  ORIENTATION_CHIPS,
  ORIENTATION_MAX_ITEMS,
  PRONOUN_MAX_LENGTH,
  PRONOUN_OPTIONS,
} from '../../settings/vocab';
import { Chip, Input, Text, Toggle } from '../../ui';
import { colors, radii, spacing } from '../../theme/tokens';

/**
 * `/profile-editor/about` (`docs/design/me-redesign/brief.md`'s `about you`
 * section, ruling 2). Pronouns and orientation are public-profile fields
 * behind one opt-in switch — never in the private card (ruling 1). `done`
 * always PUTs the whole `{pronouns, orientation, is_public}` object; there
 * is no partial-update variant (`api/identityWrite.ts`'s own doc comment).
 */
export default function AboutYouEditorScreen() {
  const queryClient = useQueryClient();

  const [pronoun, setPronoun] = useState<string | null>(null);
  const [customPronoun, setCustomPronoun] = useState('');
  const [orientation, setOrientation] = useState<string[]>([]);
  const [isPublic, setIsPublic] = useState(false);

  const [initial, setInitial] = useState<{ pronoun: string | null; customPronoun: string; orientation: string[]; isPublic: boolean }>({
    pronoun: null,
    customPronoun: '',
    orientation: [],
    isPublic: false,
  });

  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const uid = await currentUserId();
        const [identity, metaResult] = await Promise.all([
          getIdentity(uid),
          supabase.from('user_identity').select('is_public').eq('user_id', uid).maybeSingle(),
        ]);
        if (cancelled) return;

        let loadedPronoun: string | null = null;
        let loadedCustom = '';
        if (identity?.pronouns) {
          if ((PRONOUN_OPTIONS as readonly string[]).includes(identity.pronouns)) {
            loadedPronoun = identity.pronouns;
          } else {
            loadedCustom = identity.pronouns;
          }
        }
        const loadedOrientation = identity?.orientation ?? [];
        const loadedPublic = metaResult.data?.is_public ?? false;

        setPronoun(loadedPronoun);
        setCustomPronoun(loadedCustom);
        setOrientation(loadedOrientation);
        setIsPublic(loadedPublic);
        setInitial({ pronoun: loadedPronoun, customPronoun: loadedCustom, orientation: loadedOrientation, isPublic: loadedPublic });
      } catch (error) {
        if (!cancelled) setLoadError(mapSupabaseError(error).message);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const effectivePronoun = pronoun ?? (customPronoun.trim().length > 0 ? customPronoun.trim() : null);
  const customTooLong = customPronoun.trim().length > PRONOUN_MAX_LENGTH;

  const mutation = useMutation({
    mutationFn: () => putIdentity({ pronouns: effectivePronoun, orientation, is_public: isPublic }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.me.about });
      router.back();
    },
  });

  const dirty =
    pronoun !== initial.pronoun ||
    customPronoun !== initial.customPronoun ||
    isPublic !== initial.isPublic ||
    orientation.length !== initial.orientation.length ||
    orientation.some((v) => !initial.orientation.includes(v));

  function handleCancel() {
    if (!dirty) {
      router.back();
      return;
    }
    Alert.alert('discard changes?', 'the changes you made here have not been saved.', [
      { text: 'keep editing', style: 'cancel' },
      { text: 'discard', style: 'destructive', onPress: () => router.back() },
    ]);
  }

  function selectPronoun(option: string) {
    setPronoun((prev) => (prev === option ? null : option));
    setCustomPronoun('');
  }

  function onCustomPronounChange(value: string) {
    setCustomPronoun(value);
    setPronoun(null);
  }

  function toggleOrientation(value: string) {
    setOrientation((prev) => {
      if (prev.includes(value)) return prev.filter((v) => v !== value);
      if (prev.length >= ORIENTATION_MAX_ITEMS) return prev;
      return [...prev, value];
    });
  }

  if (!loaded) {
    return (
      <View style={styles.center} testID="about-editor-loading">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const errorMessage = mutation.isError ? mapSupabaseError(mutation.error).message : loadError;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} testID="about-editor-screen">
        <View style={styles.headerRow} testID="about-editor-header">
          <Text testID="about-editor-cancel" variant="rowLabel" color={colors.muted} onPress={handleCancel}>
            cancel
          </Text>
          <Text variant="title" style={styles.headerTitle} numberOfLines={1}>
            about you
          </Text>
          <Text testID="about-editor-done" variant="rowLabel" color={colors.signal} onPress={() => mutation.mutate()}>
            done
          </Text>
        </View>

        <View style={styles.section}>
          <Text variant="sectionLabel" color={colors.muted}>
            pronouns
          </Text>
          <View style={styles.chipCard}>
            <View style={styles.chipRow} testID="about-editor-pronouns">
              {PRONOUN_OPTIONS.map((option) => (
                <Chip
                  key={option}
                  testID={`about-editor-pronoun-${option}`}
                  label={option}
                  tone="tint"
                  selected={pronoun === option}
                  onPress={() => selectPronoun(option)}
                />
              ))}
            </View>
            <Input
              testID="about-editor-pronoun-custom"
              containerStyle={styles.customInput}
              placeholder="write your own"
              maxLength={PRONOUN_MAX_LENGTH + 10}
              value={customPronoun}
              onChangeText={onCustomPronounChange}
              error={customTooLong ? `keep it under ${PRONOUN_MAX_LENGTH} characters.` : undefined}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text variant="sectionLabel" color={colors.muted}>
            {"i'm"}
          </Text>
          <View style={styles.chipCard}>
            <View style={styles.chipRow} testID="about-editor-orientation">
              {ORIENTATION_CHIPS.map((option) => (
                <Chip
                  key={option}
                  testID={`about-editor-orientation-${option}`}
                  label={option}
                  tone="tint"
                  selected={orientation.includes(option)}
                  onPress={() => toggleOrientation(option)}
                />
              ))}
            </View>
          </View>
        </View>

        <View style={styles.publicRow} testID="about-editor-public-row">
          <View style={styles.publicText}>
            <Text variant="rowLabel">show on my profile</Text>
            <Text variant="micro" color={colors.inkSoft}>
              off means only you can see these. on means anyone on your campus can.
            </Text>
          </View>
          <Toggle testID="about-editor-is-public" value={isPublic} onValueChange={setIsPublic} />
        </View>

        {errorMessage ? (
          <Text variant="helper" color={colors.danger} testID="about-editor-error">
            {errorMessage}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { paddingHorizontal: spacing.lgXl, paddingBottom: spacing.huge, gap: spacing.lgXl },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.mdLg },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18 },
  section: { gap: spacing.smMd },
  chipCard: {
    backgroundColor: colors.paperRaised,
    borderRadius: radii.card,
    padding: spacing.lgXl,
    gap: spacing.mdLg,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.smMd },
  customInput: { marginTop: 0 },
  publicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.mdLg,
    backgroundColor: colors.paperRaised,
    borderRadius: radii.card,
    padding: spacing.lgXl,
  },
  publicText: { flex: 1, gap: spacing.xs },
});
