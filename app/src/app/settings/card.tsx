import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { getMyCard, putCard, type CardPutPayload } from '../../api/identityWrite';
import { mapSupabaseError } from '../../api/errors';
import { ChipPicker } from '../../settings/ChipPicker';
import { CARD_CHIPS, CARD_FIELDS, CARD_MAX_ITEMS, type CardField } from '../../settings/vocab';

const FIELD_LABELS: Record<CardField, string> = {
  into: 'Into',
  safer_sex: 'Safer sex',
  kinks: 'Kinks',
  hard_nos: 'Hard nos',
};

const EMPTY_CARD: CardPutPayload = { into: [], safer_sex: [], kinks: [], hard_nos: [] };

/**
 * `/settings/card` — the private-card editor (plan §6, decision 16/21). Four
 * lists, 0-8 chips each from `src/settings/vocab.ts`'s function-side
 * vocabulary. No pronoun/orientation fields here (decision 16) and no
 * per-field public toggle — visibility is `shares`-only (plan §5), never a
 * toggle on this screen.
 *
 * PUT is always the whole object, same as the identity editor — `putCard`'s
 * signature takes every field, never a `Partial<>`.
 */
export default function CardEditorScreen() {
  const [card, setCard] = useState<CardPutPayload>(EMPTY_CARD);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const current = await getMyCard();
        if (!cancelled && current) setCard(current);
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
    mutationFn: () => putCard(card),
    onSuccess: () => setSaved(true),
    onError: () => setSaved(false),
  });

  if (!loaded) {
    return (
      <View style={styles.center} testID="card-loading">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const errorMessage = mutation.isError ? mapSupabaseError(mutation.error).message : loadError;

  return (
    <View style={styles.container} testID="card-screen">
      {CARD_FIELDS.map((field) => (
        <View key={field} style={styles.section}>
          <Text style={styles.title}>{FIELD_LABELS[field]}</Text>
          <Text style={styles.hint}>{`Up to ${CARD_MAX_ITEMS}`}</Text>
          <ChipPicker
            testID={`card-${field}`}
            options={CARD_CHIPS[field]}
            selected={card[field]}
            maxItems={CARD_MAX_ITEMS}
            onChange={(next) => setCard((prev) => ({ ...prev, [field]: next }))}
          />
        </View>
      ))}

      {errorMessage ? (
        <Text style={styles.error} testID="card-error">
          {errorMessage}
        </Text>
      ) : null}
      {saved && !mutation.isPending ? (
        <Text style={styles.saved} testID="card-saved">
          Saved
        </Text>
      ) : null}

      <Pressable
        testID="card-save"
        style={[styles.button, mutation.isPending && styles.buttonDisabled]}
        disabled={mutation.isPending}
        accessibilityState={{ disabled: mutation.isPending }}
        onPress={() => {
          setSaved(false);
          mutation.mutate();
        }}
      >
        {mutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
      </Pressable>
      <Text testID="card-back" style={styles.back} onPress={() => router.back()}>
        Back
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  section: { marginBottom: 10, gap: 6 },
  title: { fontSize: 16, fontWeight: '600' },
  hint: { fontSize: 12, color: '#777' },
  error: { color: '#B00020', fontSize: 13 },
  saved: { color: '#1a7f37', fontSize: 13 },
  button: { marginTop: 10, backgroundColor: '#208AEF', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  buttonDisabled: { backgroundColor: '#a9c9e8' },
  buttonText: { color: '#fff', fontWeight: '600' },
  back: { textAlign: 'center', color: '#555', fontSize: 14, marginTop: 8 },
});
