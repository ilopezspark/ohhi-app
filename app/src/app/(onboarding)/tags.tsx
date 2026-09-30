import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { getUserTags, listTagCatalog, MIN_TAGS, setMyTags, type Tag } from '../../api/tags';
import { getMyAbout, listPrograms, setMyAbout } from '../../api/about';
import { InvalidInputError, mapSupabaseError } from '../../api/errors';
import type { ProgramRef } from '../../profile/about';
import { TagPicker } from '../../tags/TagPicker';
import { ProgramPickerSheet } from '../../me/editor/ProgramPickerSheet';
import { Button, CapIcon, ChevronRightIcon, Text } from '../../ui';
import { colors, radii, spacing } from '../../theme/tokens';
import { OnboardingHeader } from '../../onboarding/components/OnboardingHeader';
import { OnboardingScreen } from '../../onboarding/components/OnboardingScreen';

/**
 * Onboarding's tag step (design step 6 of 8), after migration 0018 (decision
 * 94, owner ruling 4): the full-screen interest picker, minimum 3, maximum
 * 10, no skip (`complete_onboarding()` refuses fewer than 3). The picked
 * order is saved through `set_my_tags`.
 *
 * The major used to be picked here as a tag. It is now the about section's
 * structured major, so it is still offered in the same place, as one
 * optional row above the categories that opens the campus's program list
 * (`public.programs`), saved through `set_my_about({major_id})`. Nothing
 * else about onboarding changed.
 */
export default function TagsScreen() {
  const [catalog, setCatalog] = useState<Tag[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [programs, setPrograms] = useState<ProgramRef[]>([]);
  const [savedMajor, setSavedMajor] = useState<ProgramRef | null>(null);
  const [major, setMajor] = useState<ProgramRef | null>(null);
  const [majorOpen, setMajorOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoadError(null);
      try {
        const [tagList, userTags] = await Promise.all([listTagCatalog(), getUserTags()]);
        if (cancelled) return;
        setCatalog(tagList);
        setSelected([...userTags].sort((a, b) => a.position - b.position).map((t) => t.tag_id));
        setLoaded(true);
      } catch (error) {
        if (!cancelled) setLoadError(mapSupabaseError(error).message);
        return;
      }
      // The major row is optional: if programs or the about read fail, the
      // row simply does not show and the step still works.
      try {
        const [programRows, about] = await Promise.all([listPrograms(), getMyAbout()]);
        if (cancelled) return;
        setPrograms(programRows.map(({ id, label }) => ({ id, label })));
        setSavedMajor(about.major);
        setMajor(about.major);
      } catch {
        // leave the row out
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const mutation = useMutation({
    mutationFn: async () => {
      await setMyTags(selected);
      if ((major?.id ?? null) !== (savedMajor?.id ?? null)) {
        const about = await setMyAbout({ major_id: major?.id ?? null });
        setSavedMajor(about.major);
      }
    },
    onSuccess: () => router.replace('/(onboarding)/status' as never),
    onError: (error: unknown) =>
      setErrorMessage(error instanceof InvalidInputError ? error.message : mapSupabaseError(error).message),
  });

  function handleContinue() {
    if (mutation.isPending || selected.length < MIN_TAGS) return;
    setErrorMessage(null);
    mutation.mutate();
  }

  function goBack() {
    router.replace('/(onboarding)/photo' as never);
  }

  if (!loaded) {
    return (
      <OnboardingScreen
        step={6}
        onBack={goBack}
        backTestID="tags-back"
        testID="tags-screen"
        footer={
          loadError ? (
            <Button label="try again" onPress={() => setAttempt((n) => n + 1)} testID="tags-retry" />
          ) : undefined
        }
      >
        {loadError ? (
          <Text testID="tags-load-error" variant="helper" color={colors.danger}>
            {loadError}
          </Text>
        ) : (
          <ActivityIndicator size="large" color={colors.ink} />
        )}
      </OnboardingScreen>
    );
  }

  const majorRow =
    programs.length > 0 ? (
      <Pressable
        testID="tags-major-row"
        accessibilityRole="button"
        accessibilityLabel={major ? `your major, ${major.label}` : 'add your major'}
        onPress={() => setMajorOpen(true)}
        style={({ pressed }) => [styles.majorRow, pressed && styles.pressed]}
      >
        <CapIcon size={20} color={colors.muted} />
        <View style={styles.majorText}>
          <Text variant="labelLg">{major ? major.label : 'add your major'}</Text>
          <Text variant="micro" color={colors.inkSoft}>
            {major ? 'your major. tap to change.' : 'optional. it shows on your profile, not as a tag.'}
          </Text>
        </View>
        <ChevronRightIcon size={18} color={colors.inkFaint} />
      </Pressable>
    ) : null;

  return (
    <View style={styles.flex} testID="tags-screen">
      <TagPicker
        testID="tags-picker"
        header={<OnboardingHeader step={6} onBack={goBack} backTestID="tags-back" />}
        title="what are you into"
        intro="pick 3 to 10. they show in the order you pick them."
        closeLabel="back"
        onClose={goBack}
        catalog={catalog}
        selected={selected}
        onChange={setSelected}
        min={MIN_TAGS}
        minNote="pick at least three to continue."
        verb="continue"
        onSubmit={handleContinue}
        submitting={mutation.isPending}
        error={errorMessage}
        listHeader={majorRow}
      />
      {majorOpen ? (
        <ProgramPickerSheet
          testID="tags-major-sheet"
          title="your major"
          programs={programs}
          selectedId={major?.id ?? null}
          clearLabel="no major for now"
          onPick={(program) => {
            setMajor(program);
            setMajorOpen(false);
          }}
          onDismiss={() => setMajorOpen(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.paper },
  majorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.mdLg,
    backgroundColor: colors.paperRaised,
    borderRadius: radii.card,
    paddingHorizontal: spacing.lgXl,
    paddingVertical: spacing.mdLg,
    minHeight: 56,
  },
  majorText: { flex: 1, gap: 2 },
  pressed: { opacity: 0.7 },
});
