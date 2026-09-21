import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { me } from '../../api/me';
import { getIdentity } from '../../api/identity';
import { putIdentity } from '../../api/identityWrite';
import { mapSupabaseError } from '../../api/errors';
import { supabase } from '../../api/client';
import { ChipPicker } from '../../settings/ChipPicker';
import { ORIENTATION_CHIPS, ORIENTATION_MAX_ITEMS, PRONOUN_MAX_LENGTH, PRONOUN_OPTIONS } from '../../settings/vocab';
import { Button, Chip, Header, Input, Text, Toggle } from '../../ui';
import { colors, spacing } from '../../theme/tokens';

/**
 * `/settings/identity` — pronouns + orientation editor (plan §6, decision
 * 20), reached from `/settings/card`'s header link since `Me.html` only
 * shows one combined "more about me" entry point (see that file's doc
 * comment). No dedicated mockup covers this screen either, so it's
 * restyled onto the shared tokens/`Header`/`ChipPicker` rather than a 1:1
 * port.
 *
 * "Show on my profile" (`is_public`) is off by default and never clears the
 * field values when toggled — it only changes who can `GET` them (plan §6).
 * Saves always send the whole object (`PUT /identity {pronouns, orientation,
 * is_public}`); there is no partial-update path.
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
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} testID="identity-screen">
        <Header title="pronouns & orientation" titleSize={22} onBack={() => router.back()} />

        <Text variant="rowLabel">Pronouns</Text>
        <View style={styles.chipRow} testID="identity-pronoun-options">
          {PRONOUN_OPTIONS.map((option) => (
            <Chip
              key={option}
              testID={`identity-pronoun-${option}`}
              label={option}
              selected={pronouns === option}
              onPress={() => selectPronoun(option)}
            />
          ))}
        </View>
        <Input
          testID="identity-pronoun-custom"
          placeholder="Or write your own"
          maxLength={PRONOUN_MAX_LENGTH + 10}
          value={customPronoun}
          onChangeText={onCustomPronounChange}
        />
        {customTooLong ? (
          <Text variant="helper" color={colors.danger} testID="identity-pronoun-error">{`Keep it under ${PRONOUN_MAX_LENGTH} characters.`}</Text>
        ) : null}

        <Text variant="rowLabel" style={styles.sectionSpacing}>
          Orientation
        </Text>
        <Text variant="helper">{`Up to ${ORIENTATION_MAX_ITEMS}`}</Text>
        <ChipPicker
          testID="identity-orientation"
          options={ORIENTATION_CHIPS}
          selected={orientation}
          maxItems={ORIENTATION_MAX_ITEMS}
          onChange={setOrientation}
        />

        <View style={styles.publicRow}>
          <View style={styles.publicText}>
            <Text variant="rowLabel">Show on my profile</Text>
            <Text variant="helper">Off by default. Turning this off never clears what you&apos;ve entered.</Text>
          </View>
          <Toggle testID="identity-is-public" value={isPublic} onValueChange={setIsPublic} />
        </View>

        {errorMessage ? (
          <Text variant="helper" color={colors.danger} testID="identity-error">
            {errorMessage}
          </Text>
        ) : null}
        {saved && !mutation.isPending ? (
          <Text variant="helper" color={colors.success} testID="identity-saved">
            Saved
          </Text>
        ) : null}

        <Button
          testID="identity-save"
          label="Save"
          disabled={!canSave}
          loading={mutation.isPending}
          onPress={() => {
            setSaved(false);
            mutation.mutate();
          }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { paddingHorizontal: spacing.lgXl, paddingBottom: spacing.huge, gap: spacing.md },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.smMd },
  sectionSpacing: { marginTop: spacing.md },
  publicRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md, gap: spacing.mdLg },
  publicText: { flex: 1, gap: spacing.xs },
});
