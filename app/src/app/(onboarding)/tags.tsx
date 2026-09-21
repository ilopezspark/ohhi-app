import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { me } from '../../api/me';
import { getUserTags, listTagsForCampus, setUserTags, type Tag } from '../../api/tags';
import { mapSupabaseError } from '../../api/errors';
import { MAX_TAGS } from '../../onboarding/validation';

/**
 * Tags step (onboarding-grid plan §1.4), 0-3 chips, skippable (decision 14).
 * The photo step routes here on success; this screen routes to `status` on
 * either Continue or Skip.
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

  if (!loaded) {
    return (
      <View style={styles.container} testID="tags-screen">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container} testID="tags-screen">
      <Text style={styles.title}>Add up to 3 tags</Text>
      {loadError ? <Text style={styles.error}>{loadError}</Text> : null}
      <View style={styles.chipRow}>
        {tags.map((tag) => {
          const isSelected = selected.includes(tag.id);
          return (
            <Pressable
              key={tag.id}
              testID={`tag-chip-${tag.id}`}
              accessibilityState={{ selected: isSelected }}
              style={[styles.chip, isSelected && styles.chipSelected]}
              onPress={() => toggle(tag.id)}
            >
              <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>{tag.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      <Pressable
        testID="tags-continue"
        style={[styles.button, mutation.isPending && styles.buttonDisabled]}
        disabled={mutation.isPending}
        accessibilityState={{ disabled: mutation.isPending }}
        onPress={handleContinue}
      >
        {mutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Continue</Text>}
      </Pressable>
      <Pressable testID="tags-skip" disabled={mutation.isPending} onPress={handleSkip}>
        <Text style={styles.skipText}>Skip</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center', gap: 12 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: '#208AEF',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipSelected: { backgroundColor: '#208AEF' },
  chipText: { color: '#208AEF', fontSize: 14 },
  chipTextSelected: { color: '#fff' },
  error: { color: '#b00020', fontSize: 13 },
  button: {
    marginTop: 8,
    backgroundColor: '#208AEF',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: '#a9c9e8' },
  buttonText: { color: '#fff', fontWeight: '600' },
  skipText: { color: '#555', textAlign: 'center', marginTop: 12, fontSize: 14 },
});
