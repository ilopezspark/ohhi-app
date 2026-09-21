import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { me } from '../../api/me';
import { getUserTags, listTagsForCampus, setUserTags, type Tag } from '../../api/tags';
import { mapSupabaseError } from '../../api/errors';
import { MAX_TAGS } from '../../onboarding/validation';
import { Button, Chip, Text } from '../../ui';
import { colors, spacing } from '../../theme/tokens';
import { OnboardingScreen } from '../../onboarding/components/OnboardingScreen';

/**
 * `Onb-Status.html`'s tag-chip field ("pick up to three tags"). The design
 * combines a status line and tags on one "status & tags" screen; the app
 * keeps them as separate steps (`tags.tsx` then `status.tsx`, unchanged by
 * this pass — `docs/design/system.md` already documents this split). Both
 * screens share the design's step 6 of 8. Tags step (onboarding-grid plan
 * §1.4), 0-3 chips, skippable (decision 14). The photo step routes here on
 * success; this screen routes to `status` on either Continue or Skip.
 */
export default function TagsScreen() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const meResult = await me();
        const [tagList, userTags] = await Promise.all([
          listTagsForCampus(meResult?.campus_id ?? null),
          getUserTags(),
        ]);
        if (!cancelled) {
          setTags(tagList);
          setSelected(
            [...userTags].sort((a, b) => a.position - b.position).map((t) => t.tag_id)
          );
        }
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

  const mutation = useMutation({
    mutationFn: (tagIds: string[]) => setUserTags(tagIds),
    onSuccess: () => router.replace('/(onboarding)/status' as never),
    onError: (error: unknown) => setErrorMessage(mapSupabaseError(error).message),
  });

  function toggle(tagId: string) {
    setSelected((prev) => {
      if (prev.includes(tagId)) return prev.filter((id) => id !== tagId);
      if (prev.length >= MAX_TAGS) return prev;
      return [...prev, tagId];
    });
  }

  function handleContinue() {
    if (mutation.isPending) return;
    setErrorMessage(null);
    mutation.mutate(selected);
  }

  function handleSkip() {
    if (mutation.isPending) return;
    setErrorMessage(null);
    mutation.mutate([]);
  }

  function goBack() {
    router.replace('/(onboarding)/photo' as never);
  }

  if (!loaded) {
    return (
      <OnboardingScreen step={6} onBack={goBack} backTestID="tags-back" testID="tags-screen">
        <ActivityIndicator size="large" color={colors.ink} />
      </OnboardingScreen>
    );
  }

  return (
    <OnboardingScreen
      step={6}
      onBack={goBack}
      backTestID="tags-back"
      testID="tags-screen"
      footer={
        <>
          <Button label="continue" onPress={handleContinue} loading={mutation.isPending} disabled={mutation.isPending} testID="tags-continue" />
          <Button label="skip for now" variant="ghost" onPress={handleSkip} disabled={mutation.isPending} testID="tags-skip" />
        </>
      }
    >
      <Text variant="headline" style={{ marginTop: spacing.md }}>
        pick up to three tags
      </Text>
      {loadError ? (
        <Text testID="tags-load-error" variant="helper" color={colors.danger}>
          {loadError}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.smMd }}>
        {tags.map((tag) => {
          const isSelected = selected.includes(tag.id);
          return (
            <Chip
              key={tag.id}
              testID={`tag-chip-${tag.id}`}
              label={tag.label}
              selected={isSelected}
              onPress={() => toggle(tag.id)}
            />
          );
        })}
      </View>
      <Text variant="helper">these show on your tile so people have something to say hi about.</Text>
      {errorMessage ? (
        <Text testID="tags-error" variant="helper" color={colors.danger}>
          {errorMessage}
        </Text>
      ) : null}
    </OnboardingScreen>
  );
}
