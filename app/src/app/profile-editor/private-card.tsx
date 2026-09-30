import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getMyCard, putCard, type CardPutPayload } from '../../api/identityWrite';
import { mapSupabaseError } from '../../api/errors';
import { queryKeys } from '../../me/queryKeys';
import { CARD_FIELD_LABELS } from '../../me/card/fieldLabels';
import { hardNosAtCap, normalizeTypedHardNo, type HardNoRejection } from '../../me/card/hardNos';
import {
  CARD_CHIPS,
  CARD_CHIP_MAX_LENGTH,
  CARD_MAX_ITEMS,
  SAFER_SEX_TESTED_MONTHS,
  SAFER_SEX_TESTED_PATTERN,
  type CardField,
} from '../../settings/vocab';
import { Button, Chip, Input, KeyboardScrollView, Sheet, Text } from '../../ui';
import { LockIcon } from '../../ui/icons';
import { colors, radii, shadows, spacing } from '../../theme/tokens';
import { HEADER_TOP_GAP } from '../../ui/screenInsets';

const EMPTY_CARD: CardPutPayload = { into: [], safer_sex: [], kinks: [], hard_nos: [] };
const CURRENT_YEAR = new Date().getFullYear();
const TESTED_YEAR_OPTIONS = Array.from({ length: 6 }, (_, i) => String((CURRENT_YEAR - i) % 100).padStart(2, '0'));

function hardNoErrorCopy(rejection: HardNoRejection | undefined): string {
  switch (rejection) {
    case 'too_long':
      return `keep it under ${CARD_CHIP_MAX_LENGTH} characters.`;
    case 'duplicate':
      return 'you already have that one.';
    case 'control_char':
      return "that has a character we can't save — try retyping it.";
    case 'empty':
    default:
      return 'type something first.';
  }
}

/**
 * `/profile-editor/private-card` (`EditPrivateCard`, `08-edit-private-card.png`).
 * Rulings 1/3/4/5/6: four groups (into, safer sex, kinks, hard nos), hard
 * nos always last with a warm border and typed entries, no pronoun/
 * orientation fields here at all (those live at `/profile-editor/about`),
 * no "single" chip anywhere in the fixed vocabulary.
 */
export default function EditPrivateCardScreen() {
  const queryClient = useQueryClient();

  const [card, setCard] = useState<CardPutPayload>(EMPTY_CARD);
  const [initialCard, setInitialCard] = useState<CardPutPayload>(EMPTY_CARD);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [testedSheetOpen, setTestedSheetOpen] = useState(false);
  const [testedMonth, setTestedMonth] = useState<string | null>(null);
  const [testedYear, setTestedYear] = useState<string | null>(null);

  const [addingHardNo, setAddingHardNo] = useState(false);
  const [hardNoDraft, setHardNoDraft] = useState('');
  const [hardNoError, setHardNoError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const current = await getMyCard();
        if (!cancelled && current) {
          setCard(current);
          setInitialCard(current);
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
    mutationFn: () => putCard(card),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.me.card });
      router.back();
    },
  });

  const dirty = JSON.stringify(card) !== JSON.stringify(initialCard);

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

  function toggle(field: CardField, value: string) {
    setCard((prev) => {
      const arr = prev[field];
      if (arr.includes(value)) return { ...prev, [field]: arr.filter((v) => v !== value) };
      if (arr.length >= CARD_MAX_ITEMS) return prev;
      return { ...prev, [field]: [...arr, value] };
    });
  }

  const testedValue = card.safer_sex.find((v) => SAFER_SEX_TESTED_PATTERN.test(v)) ?? null;

  function onTestedPress() {
    if (testedValue) {
      toggle('safer_sex', testedValue);
      return;
    }
    setTestedMonth(null);
    setTestedYear(null);
    setTestedSheetOpen(true);
  }

  function confirmTested() {
    if (!testedMonth || !testedYear) return;
    const value = `tested ${testedMonth} '${testedYear}`;
    setCard((prev) => {
      if (prev.safer_sex.includes(value) || prev.safer_sex.length >= CARD_MAX_ITEMS) return prev;
      return { ...prev, safer_sex: [...prev.safer_sex, value] };
    });
    setTestedSheetOpen(false);
  }

  function startAddHardNo() {
    if (hardNosAtCap(card.hard_nos)) return;
    setHardNoDraft('');
    setHardNoError(null);
    setAddingHardNo(true);
  }

  function cancelAddHardNo() {
    setAddingHardNo(false);
    setHardNoDraft('');
    setHardNoError(null);
  }

  function submitHardNo() {
    const result = normalizeTypedHardNo(hardNoDraft, card.hard_nos);
    if (!result.ok) {
      setHardNoError(hardNoErrorCopy(result.rejection));
      return;
    }
    setCard((prev) => ({ ...prev, hard_nos: [...prev.hard_nos, result.value] }));
    setAddingHardNo(false);
    setHardNoDraft('');
    setHardNoError(null);
  }

  if (!loaded) {
    return (
      <View style={styles.center} testID="private-card-editor-loading">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const errorMessage = mutation.isError ? mapSupabaseError(mutation.error).message : loadError;
  const hardNoValues = [...CARD_CHIPS.hard_nos, ...card.hard_nos.filter((v) => !CARD_CHIPS.hard_nos.includes(v))];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardScrollView contentContainerStyle={styles.container} testID="private-card-editor-screen">
        <View style={styles.headerRow} testID="private-card-editor-header">
          <Text testID="private-card-editor-cancel" variant="rowLabel" color={colors.muted} onPress={handleCancel}>
            cancel
          </Text>
          <Text variant="title" style={styles.headerTitle} numberOfLines={1}>
            more about me
          </Text>
          <Text
            testID="private-card-editor-done"
            variant="rowLabel"
            color={colors.signal}
            onPress={() => mutation.mutate()}
          >
            done
          </Text>
        </View>

        <View style={styles.explainer} testID="private-card-editor-explainer">
          <LockIcon size={20} color={colors.ink} />
          <Text variant="bodyMedium" color={colors.ink} style={styles.explainerText}>
            filling this in doesn&apos;t show it to anyone. you still choose who gets it, one chat at a time.
          </Text>
        </View>

        {(['into', 'safer_sex', 'kinks'] as const).map((field) => (
          <View key={field} style={styles.section}>
            <Text variant="sectionLabel" color={colors.muted}>
              {CARD_FIELD_LABELS[field]}
            </Text>
            <View style={styles.chipCard}>
              <View style={styles.chipRow} testID={`private-card-editor-${field}`}>
                {CARD_CHIPS[field].map((option) => (
                  <Chip
                    key={option}
                    testID={`private-card-editor-${field}-${option}`}
                    label={option}
                    tone="tint"
                    selected={card[field].includes(option)}
                    onPress={() => toggle(field, option)}
                  />
                ))}
                {field === 'safer_sex' ? (
                  <Chip
                    testID="private-card-editor-tested"
                    label={testedValue ?? 'tested…'}
                    tone={testedValue ? 'tint' : 'action'}
                    selected={!!testedValue}
                    onPress={onTestedPress}
                  />
                ) : null}
              </View>
            </View>
          </View>
        ))}

        <View style={styles.section}>
          <Text variant="sectionLabel" color={colors.muted} style={styles.hardNosLabelRow}>
            {CARD_FIELD_LABELS.hard_nos}
          </Text>
          <Text variant="micro" color={colors.inkSoft} style={styles.hardNosNote} testID="private-card-editor-hard-nos-note">
            always shown last
          </Text>
          <View style={[styles.chipCard, styles.hardNosCard]}>
            <View style={styles.chipRow} testID="private-card-editor-hard_nos">
              {hardNoValues.map((value) => (
                <Chip
                  key={value}
                  testID={`private-card-editor-hard_nos-${value}`}
                  label={value}
                  tone="boundary"
                  selected={card.hard_nos.includes(value)}
                  onPress={() => toggle('hard_nos', value)}
                />
              ))}
              {!addingHardNo && !hardNosAtCap(card.hard_nos) ? (
                <Chip
                  testID="private-card-editor-hard-nos-add"
                  label="+ add your own"
                  tone="action"
                  onPress={startAddHardNo}
                />
              ) : null}
            </View>

            {addingHardNo ? (
              <View style={styles.addRow} testID="private-card-editor-hard-nos-add-row">
                <Input
                  testID="private-card-editor-hard-nos-input"
                  surface="card"
                  value={hardNoDraft}
                  onChangeText={(text) => {
                    setHardNoDraft(text);
                    setHardNoError(null);
                  }}
                  maxLength={CARD_CHIP_MAX_LENGTH}
                  placeholder="type your own"
                  autoFocus
                  onSubmitEditing={submitHardNo}
                  helper={hardNoError ? undefined : `${hardNoDraft.length}/${CARD_CHIP_MAX_LENGTH}`}
                />
                {hardNoError ? (
                  <Text variant="helper" color={colors.danger} testID="private-card-editor-hard-nos-error">
                    {hardNoError}
                  </Text>
                ) : null}
                <View style={styles.addRowActions}>
                  <Chip testID="private-card-editor-hard-nos-confirm" label="add" tone="action" onPress={submitHardNo} />
                  <Chip testID="private-card-editor-hard-nos-cancel" label="cancel" tone="tint" onPress={cancelAddHardNo} />
                </View>
              </View>
            ) : null}
          </View>
        </View>

        <Text variant="helper" color={colors.inkSoft} style={styles.footer}>
          sharing this is never automatic, and it never happens before you&apos;ve both said hi.
        </Text>

        {errorMessage ? (
          <Text variant="helper" color={colors.danger} testID="private-card-editor-error">
            {errorMessage}
          </Text>
        ) : null}
      </KeyboardScrollView>

      {testedSheetOpen ? (
        <Sheet testID="private-card-editor-tested-sheet" onDismiss={() => setTestedSheetOpen(false)}>
          <Text variant="titleLg">tested</Text>
          <View style={styles.pickerRow}>
            {SAFER_SEX_TESTED_MONTHS.map((month) => (
              <Chip
                key={month}
                testID={`private-card-editor-tested-month-${month}`}
                label={month}
                selected={testedMonth === month}
                onPress={() => setTestedMonth(month)}
              />
            ))}
          </View>
          <View style={styles.pickerRow}>
            {TESTED_YEAR_OPTIONS.map((year) => (
              <Chip
                key={year}
                testID={`private-card-editor-tested-year-${year}`}
                label={`'${year}`}
                selected={testedYear === year}
                onPress={() => setTestedYear(year)}
              />
            ))}
          </View>
          <Button
            testID="private-card-editor-tested-confirm"
            label="set"
            disabled={!testedMonth || !testedYear}
            onPress={confirmTested}
          />
        </Sheet>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { paddingHorizontal: spacing.lgXl, paddingBottom: spacing.huge, gap: spacing.lgXl },
  // The Me screen's heading padding (owner ruling): the shared 12 below the status bar.
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.mdLg, paddingTop: HEADER_TOP_GAP },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18 },
  explainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.mdLg,
    backgroundColor: colors.paperTint,
    borderRadius: radii.card,
    padding: spacing.lgXl,
  },
  explainerText: { flex: 1, lineHeight: 20 },
  section: { gap: spacing.smMd },
  chipCard: {
    backgroundColor: colors.paperRaised,
    borderRadius: radii.card,
    padding: spacing.lgXl,
    ...shadows.sm,
  },
  hardNosCard: { borderWidth: 1.5, borderColor: colors.boundaryInk },
  hardNosLabelRow: { marginBottom: -spacing.lg },
  hardNosNote: { alignSelf: 'flex-end', marginBottom: spacing.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.smMd },
  addRow: { marginTop: spacing.mdLg, gap: spacing.smMd },
  addRowActions: { flexDirection: 'row', gap: spacing.smMd },
  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.smMd },
  footer: { lineHeight: 18 },
});
