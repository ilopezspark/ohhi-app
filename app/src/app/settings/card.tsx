import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { getMyCard, putCard, type CardPutPayload } from '../../api/identityWrite';
import { mapSupabaseError } from '../../api/errors';
import { ChipPicker } from '../../settings/ChipPicker';
import { CARD_CHIPS, CARD_FIELDS, CARD_MAX_ITEMS, type CardField } from '../../settings/vocab';
import { Button, Header, Text } from '../../ui';
import { colors, spacing } from '../../theme/tokens';

const FIELD_LABELS: Record<CardField, string> = {
  into: 'Into',
  safer_sex: 'Safer sex',
  kinks: 'Kinks',
  hard_nos: 'Hard nos',
};

const EMPTY_CARD: CardPutPayload = { into: [], safer_sex: [], kinks: [], hard_nos: [] };

/**
 * `/settings/card` — the private-card editor, `Me.html`'s "more about me"
 * row's destination (plan §6, decision 16/21). Four lists, 0-8 chips each
 * from `src/settings/vocab.ts`'s function-side vocabulary. No pronoun/
 * orientation fields here (decision 16) and no per-field public toggle —
 * visibility is `shares`-only (plan §5), never a toggle on this screen.
 *
 * The mockup has no dedicated card-editor screen of its own (`Me.html`'s
 * "more about me" row is a single entry point with no matching detail
 * mockup among the 24), so this is restyled onto the shared tokens/`Header`/
 * `ChipPicker` rather than a 1:1 port. It links out to `/settings/identity`
 * (the pronouns/orientation editor decision 16 keeps separate from the
 * card) since `Me.html` only shows one combined entry point but the app
 * keeps the two edit flows split — see that file's own doc comment.
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
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} testID="card-screen">
        <Header
          title="more about me"
          titleSize={26}
          onBack={() => router.back()}
          right={
            <Text testID="card-identity-link" variant="rowLabel" color={colors.signal} onPress={() => router.push('/settings/identity' as never)}>
              pronouns
            </Text>
          }
        />

        {CARD_FIELDS.map((field) => (
          <View key={field} style={styles.section}>
            <Text variant="rowLabel">{FIELD_LABELS[field]}</Text>
            <Text variant="helper">{`Up to ${CARD_MAX_ITEMS}`}</Text>
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
          <Text variant="helper" color={colors.danger} testID="card-error">
            {errorMessage}
          </Text>
        ) : null}
        {saved && !mutation.isPending ? (
          <Text variant="helper" color={colors.success} testID="card-saved">
            Saved
          </Text>
        ) : null}

        <Button
          testID="card-save"
          label="Save"
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
  container: { paddingHorizontal: spacing.lgXl, paddingBottom: spacing.huge, gap: spacing.xl },
  section: { gap: spacing.smMd },
});
