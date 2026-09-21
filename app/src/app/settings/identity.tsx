import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { me } from '../../api/me';
import { getIdentity } from '../../api/identity';
import { putIdentity } from '../../api/identityWrite';
import { mapSupabaseError } from '../../api/errors';
import { supabase } from '../../api/client';
import { ChipPicker } from '../../settings/ChipPicker';
import { ORIENTATION_CHIPS, ORIENTATION_MAX_ITEMS, PRONOUN_MAX_LENGTH, PRONOUN_OPTIONS } from '../../settings/vocab';

/**
 * `/settings/identity` — pronouns + orientation editor (plan §6, decision 20).
 *
 * "Show on my profile" (`is_public`) is off by default and never clears the
 * field values when toggled — it only changes who can `GET` them (plan §6).
 * Saves always send the whole object (`PUT /identity {pronouns, orientation,
 * is_public}`); there is no partial-update path.
 *
 * Current values load from the other agent's `getIdentity` (owner path
 * returns the full `{pronouns, orientation}` payload, or `null` on a 404 —
 * "never written yet", per the function's README, including for the owner).
 * `is_public`/`fields_filled` aren't in that wrapper's return type, so
 * they're read directly off `user_identity`'s owner-granted columns
 * (`select (user_id, is_public, key_version, fields_filled, updated_at)`,
 * migration 0002 §10) — a different read path from `getIdentity`, not a
 * reimplementation of it.
 */
export default function IdentityEditorScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [pronouns, setPronouns] = useState<string | null>(null);
  const [customPronoun, setCustomPronoun] = useState('');
  const [orientation, setOrientation] = useState<string[]>([]);
  const [isPublic, setIsPublic] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const meResult = await me();
        if (!meResult) throw new Error('not signed in');
        if (cancelled) return;
        setUserId(meResult.id);

        const [identity, metaResult] = await Promise.all([
          getIdentity(meResult.id),
          supabase.from('user_identity').select('is_public').eq('user_id', meResult.id).maybeSingle(),
        ]);
        if (cancelled) return;

        if (identity) {
          if (identity.pronouns && (PRONOUN_OPTIONS as readonly string[]).includes(identity.pronouns)) {
            setPronouns(identity.pronouns);
          } else if (identity.pronouns) {
            setCustomPronoun(identity.pronouns);
          }
          setOrientation(identity.orientation);
        }
        setIsPublic(metaResult.data?.is_public ?? false);
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

  const effectivePronoun = pronouns ?? (customPronoun.trim().length > 0 ? customPronoun.trim() : null);
  const customTooLong = customPronoun.trim().length > PRONOUN_MAX_LENGTH;

  const mutation = useMutation({
    mutationFn: () => putIdentity({ pronouns: effectivePronoun, orientation, is_public: isPublic }),
    onSuccess: () => setSaved(true),
    onError: () => setSaved(false),
  });

  function selectPronoun(option: string) {
    setPronouns((prev) => (prev === option ? null : option));
    setCustomPronoun('');
  }

  function onCustomPronounChange(value: string) {
    setCustomPronoun(value);
    setPronouns(null);
  }

  if (!loaded) {
    return (
      <View style={styles.center} testID="identity-loading">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const errorMessage = mutation.isError ? mapSupabaseError(mutation.error).message : loadError;
  const canSave = !!userId && !customTooLong && !mutation.isPending;

  return (
    <View style={styles.container} testID="identity-screen">
      <Text style={styles.title}>Pronouns</Text>
      <View style={styles.chipRow} testID="identity-pronoun-options">
        {PRONOUN_OPTIONS.map((option) => {
          const selected = pronouns === option;
          return (
            <Pressable
              key={option}
              testID={`identity-pronoun-${option}`}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => selectPronoun(option)}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option}</Text>
            </Pressable>
          );
        })}
      </View>
      <TextInput
        testID="identity-pronoun-custom"
        style={styles.input}
        placeholder="Or write your own"
        maxLength={PRONOUN_MAX_LENGTH + 10}
        value={customPronoun}
        onChangeText={onCustomPronounChange}
      />
      {customTooLong ? (
        <Text style={styles.error} testID="identity-pronoun-error">{`Keep it under ${PRONOUN_MAX_LENGTH} characters.`}</Text>
      ) : null}

      <Text style={styles.title}>Orientation</Text>
      <Text style={styles.hint}>{`Up to ${ORIENTATION_MAX_ITEMS}`}</Text>
      <ChipPicker
        testID="identity-orientation"
        options={ORIENTATION_CHIPS}
        selected={orientation}
        maxItems={ORIENTATION_MAX_ITEMS}
        onChange={setOrientation}
      />

      <View style={styles.publicRow}>
        <View style={styles.publicText}>
          <Text style={styles.title}>Show on my profile</Text>
          <Text style={styles.hint}>Off by default. Turning this off never clears what you&apos;ve entered.</Text>
        </View>
        <Switch testID="identity-is-public" value={isPublic} onValueChange={setIsPublic} />
      </View>

      {errorMessage ? (
        <Text style={styles.error} testID="identity-error">
          {errorMessage}
        </Text>
      ) : null}
      {saved && !mutation.isPending ? (
        <Text style={styles.saved} testID="identity-saved">
          Saved
        </Text>
      ) : null}

      <Pressable
        testID="identity-save"
        style={[styles.button, !canSave && styles.buttonDisabled]}
        disabled={!canSave}
        accessibilityState={{ disabled: !canSave }}
        onPress={() => {
          setSaved(false);
          mutation.mutate();
        }}
      >
        {mutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
      </Pressable>
      <Text testID="identity-back" style={styles.back} onPress={() => router.back()}>
        Back
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '600', marginTop: 10 },
  hint: { fontSize: 12, color: '#777' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#208AEF', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  chipSelected: { backgroundColor: '#208AEF' },
  chipText: { color: '#208AEF', fontSize: 14 },
  chipTextSelected: { color: '#fff' },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  publicRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, gap: 10 },
  publicText: { flex: 1 },
  error: { color: '#B00020', fontSize: 13 },
  saved: { color: '#1a7f37', fontSize: 13 },
  button: { marginTop: 10, backgroundColor: '#208AEF', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  buttonDisabled: { backgroundColor: '#a9c9e8' },
  buttonText: { color: '#fff', fontWeight: '600' },
  back: { textAlign: 'center', color: '#555', fontSize: 14, marginTop: 8 },
});
