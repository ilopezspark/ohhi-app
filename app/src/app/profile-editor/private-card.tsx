import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { putCard } from '../../api/identityWrite';
import { mapSupabaseError } from '../../api/errors';
import { queryKeys } from '../../me/queryKeys';
import { CARD_GROUP_LABELS, CARD_SECTION_ROWS } from '../../me/card/fieldLabels';
import { CARD_GROUP_CAPTIONS } from '../../me/card/groupCaptions';
import { hardNosAtCap, normalizeTypedHardNo, typedHardNos, type HardNoRejection } from '../../me/card/hardNos';
import { cardPatch, fetchMyCard, inOptionOrder } from '../../me/card/myCard';
import {
  CARD_SECTION_SPECS,
  emptyCardPayload,
  isSingleField,
  isWordFilterError,
  WORD_FILTER_COPY,
  type CardGroup,
  type CardPayload,
  type CardSection,
} from '../../profile/fields';
import { CARD_GROUP_ORDER, HARD_NO_MAX_LENGTH, HARD_NO_MAX_TYPED, HARD_NO_OPTIONS, PRACTICE_GROUP_ORDER, PRACTICE_GROUPS } from '../../settings/vocab';
import { Button, Chip, Input, KeyboardScrollView, ScreenHeader, Text } from '../../ui';
import { LockIcon } from '../../ui/icons';
import { colors, radii, shadows, spacing } from '../../theme/tokens';

/** Keyboard gap under the typed hard-no field: its counter, an error line, the add / cancel chips and the card's padding. */
const HARD_NO_FIELD_GAP = 112;

function hardNoErrorCopy(rejection: HardNoRejection | undefined): string {
  switch (rejection) {
    case 'too_long':
      return `keep it to ${HARD_NO_MAX_LENGTH} characters.`;
    case 'duplicate':
      return 'you already have that one.';
    case 'too_many':
      return `${HARD_NO_MAX_TYPED} of your own at most.`;
    case 'control_char':
      return "that has a character we can't save. try retyping it.";
    case 'empty':
    default:
      return 'type something first.';
  }
}

/**
 * `/profile-editor/private-card`: the private card, payload v2 (brief §3,
 * reconcile C3, owner rulings 3 and 6). Nine sections in three groups, each
 * group captioned with what a share includes:
 *
 * - getting closer: how i show i like someone, pace, living situation,
 *   hosting (the last three pick one);
 * - intimacy: safer sex, dynamics, what i'm into (the practice picker, under
 *   its sub-headers, stored as one flat list);
 * - boundaries, last and in the boundary colours: hard nos (every fixed chip
 *   may be picked, plus up to five of your own) and privacy.
 *
 * Labels are the owner's (`me/card/fieldLabels.ts`, exempt from the voice
 * rules). `save` sends only the sections that changed (`putCard` is a partial
 * patch); the word filter's refusal shows on the hard nos, with what was
 * typed kept so it can be edited.
 */
export default function EditPrivateCardScreen() {
  const queryClient = useQueryClient();

  const [card, setCard] = useState<CardPayload>(emptyCardPayload);
  const [initialCard, setInitialCard] = useState<CardPayload>(emptyCardPayload);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [addingHardNo, setAddingHardNo] = useState(false);
  const [hardNoDraft, setHardNoDraft] = useState('');
  const [hardNoError, setHardNoError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMyCard()
      .then((current) => {
        if (cancelled) return;
        setCard(current);
        setInitialCard(current);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(mapSupabaseError(error).message);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const patch = cardPatch(initialCard, card);
  const dirty = Object.keys(patch).length > 0;

  const mutation = useMutation({
    mutationFn: () => putCard(patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.me.card });
      router.back();
    },
  });

  function save() {
    if (!dirty) {
      router.back();
      return;
    }
    mutation.mutate();
  }

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

  function toggle(section: CardSection, value: string) {
    mutation.reset();
    setCard((prev) => {
      if (isSingleField(section)) {
        return { ...prev, [section]: prev[section] === value ? null : value };
      }
      const current = prev[section] as string[];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      return { ...prev, [section]: inOptionOrder(section, next) };
    });
  }

  function isSelected(section: CardSection, value: string): boolean {
    const current = card[section];
    return Array.isArray(current) ? current.includes(value) : current === value;
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
    mutation.reset();
    setCard((prev) => ({ ...prev, hard_nos: inOptionOrder('hard_nos', [...prev.hard_nos, result.value]) }));
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

  const wordFilterRefused = mutation.isError && isWordFilterError(mutation.error);
  const errorMessage = mutation.isError && !wordFilterRefused ? mapSupabaseError(mutation.error).message : loadError;

  function chip(section: CardSection, value: string, tone: 'tint' | 'boundary' = 'tint') {
    return (
      <Chip
        key={value}
        testID={`private-card-editor-${section}-${value}`}
        label={value}
        tone={tone}
        selected={isSelected(section, value)}
        onPress={() => toggle(section, value)}
      />
    );
  }

  function renderSection(section: CardSection) {
    if (section === 'practices') {
      return (
        <View style={styles.practiceGroups}>
          {PRACTICE_GROUP_ORDER.map((practiceGroup) => (
            <View key={practiceGroup} style={styles.practiceGroup} testID={`private-card-editor-practices-group-${practiceGroup}`}>
              <Text variant="micro" color={colors.inkSoft}>
                {practiceGroup}
              </Text>
              <View style={styles.chipRow}>{PRACTICE_GROUPS[practiceGroup].map((option) => chip('practices', option))}</View>
            </View>
          ))}
        </View>
      );
    }

    if (section === 'hard_nos') {
      const typed = typedHardNos(card.hard_nos);
      return (
        <>
          <View style={styles.chipRow}>
            {[...HARD_NO_OPTIONS, ...typed].map((value) => chip('hard_nos', value, 'boundary'))}
            {!addingHardNo && !hardNosAtCap(card.hard_nos) ? (
              <Chip testID="private-card-editor-hard-nos-add" label="+ write your own" tone="action" onPress={startAddHardNo} />
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
                maxLength={HARD_NO_MAX_LENGTH}
                placeholder="type your own"
                autoFocus
                onSubmitEditing={submitHardNo}
                helper={hardNoError ? undefined : `${hardNoDraft.length}/${HARD_NO_MAX_LENGTH}`}
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

          {wordFilterRefused ? (
            <Text variant="helper" color={colors.danger} testID="private-card-editor-hard-nos-filter-error">
              {WORD_FILTER_COPY}
            </Text>
          ) : null}
        </>
      );
    }

    const tone = section === 'privacy' ? 'boundary' : 'tint';
    return <View style={styles.chipRow}>{CARD_SECTION_SPECS[section].options.map((option) => chip(section, option, tone))}</View>;
  }

  function renderGroup(group: CardGroup) {
    const boundary = group === 'always_attached';
    return (
      <View key={group} style={styles.group} testID={`private-card-editor-group-${group}`}>
        <View style={styles.groupHead}>
          <Text variant="sectionLabel" color={boundary ? colors.boundaryInk : colors.muted}>
            {CARD_GROUP_LABELS[group]}
          </Text>
          <Text variant="micro" color={colors.inkSoft} testID={`private-card-editor-caption-${group}`}>
            {CARD_GROUP_CAPTIONS[group]}
          </Text>
        </View>
        {CARD_SECTION_ROWS.filter((row) => row.group === group).map((row) => (
          <View key={row.section} style={styles.section}>
            <Text variant="micro" color={boundary ? colors.boundaryInk : colors.muted}>
              {row.label}
            </Text>
            <View
              style={[styles.chipCard, boundary && styles.boundaryCard]}
              testID={`private-card-editor-${row.section}`}
              accessibilityRole={isSingleField(row.section) ? 'radiogroup' : undefined}
            >
              {renderSection(row.section)}
            </View>
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.safe}>
      <ScreenHeader
        title="private card"
        titleSize={26}
        onBack={handleCancel}
        backTestID="private-card-editor-cancel"
        testID="private-card-editor-header"
      />
      <KeyboardScrollView
        contentContainerStyle={styles.container}
        // A typed hard no has its counter, an error line and the add / cancel
        // chips under the field: keep all of them above the keyboard.
        bottomOffset={HARD_NO_FIELD_GAP}
        testID="private-card-editor-screen"
        footer={
          <Button
            testID="private-card-editor-save"
            label="save"
            loading={mutation.isPending}
            disabled={mutation.isPending}
            onPress={save}
          />
        }
        footerStyle={styles.footer}
      >
        <View style={styles.explainer} testID="private-card-editor-explainer">
          <LockIcon size={20} color={colors.ink} />
          <Text variant="bodyMedium" color={colors.ink} style={styles.explainerText}>
            filling this in doesn&apos;t show it to anyone. you still choose who gets it, one chat at a time.
          </Text>
        </View>

        {CARD_GROUP_ORDER.map(renderGroup)}

        <Text variant="helper" color={colors.inkSoft} style={styles.note}>
          sharing this is never automatic, and it never happens before you&apos;ve both said hi.
        </Text>

        {errorMessage ? (
          <Text variant="helper" color={colors.danger} testID="private-card-editor-error">
            {errorMessage}
          </Text>
        ) : null}
      </KeyboardScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { paddingHorizontal: spacing.lgXl, paddingTop: spacing.mdLg, paddingBottom: spacing.huge, gap: spacing.xxl },
  explainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.mdLg,
    backgroundColor: colors.paperTint,
    borderRadius: radii.card,
    padding: spacing.lgXl,
  },
  explainerText: { flex: 1, lineHeight: 20 },
  group: { gap: spacing.lg },
  groupHead: { gap: spacing.xs },
  section: { gap: spacing.smMd },
  chipCard: {
    backgroundColor: colors.paperRaised,
    borderRadius: radii.card,
    padding: spacing.lgXl,
    ...shadows.sm,
  },
  boundaryCard: { borderWidth: 1.5, borderColor: colors.boundaryInk },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.smMd },
  practiceGroups: { gap: spacing.lg },
  practiceGroup: { gap: spacing.smMd },
  addRow: { marginTop: spacing.mdLg, gap: spacing.smMd },
  addRowActions: { flexDirection: 'row', gap: spacing.smMd },
  note: { lineHeight: 18 },
  footer: { paddingHorizontal: spacing.lgXl, paddingTop: spacing.mdLg },
});
