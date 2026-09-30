import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  BackHandler,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { ProgramSuggestionError, suggestProgram } from '../../api/about';
import { FIELD_ERROR_FALLBACK } from '../../profile/fields';
import { PROGRAM_SUGGESTION_MAX_LENGTH, type ProgramKind, type ProgramRef } from '../../profile/about';
import { Button, CheckIcon, Input, SearchIcon, Sheet, Text, XIcon } from '../../ui';
import { colors, radii, spacing } from '../../theme/tokens';
import {
  findListedProgram,
  isSearching,
  programOptions,
  programsForKind,
  resultCountText,
  showClearRow,
  suggestionFromQuery,
  type ProgramOption,
} from './programPickerModel';

export interface ProgramPickerSheetProps {
  /** What is being picked. The minor picker shows the chosen major disabled. */
  kind: ProgramKind;
  /** Defaults to `your major` / `your minor`. */
  title?: string;
  /** The campus's active programs (`public.programs`), in server order, labels shown as stored. */
  programs: ProgramRef[];
  selectedId: string | null;
  /** Minor only: the chosen major, shown in the list but not pickable. */
  majorId?: string | null;
  /** `null` clears. The caller closes the sheet. */
  onPick: (program: ProgramRef | null) => void;
  onDismiss: () => void;
  /** The row that clears the choice, e.g. `no minor`. Omit to offer no clear row. */
  clearLabel?: string;
  testID: string;
}

/** Row height: a 48pt target plus its rule. */
const ROW_HEIGHT = 52;

/**
 * The major/minor picker, one component for the about editor
 * (`/profile-editor/school-and-work`, major and minor) and onboarding's tag
 * step (the optional major row). A tall in-tree `Sheet`:
 *
 * - a search field at the top (not focused on open, so the list shows
 *   first) that is case-insensitive, matches anywhere in a label, ignores
 *   punctuation and extra spaces, and knows the short labels' long names
 *   (`programAliases.ts`: `computer` finds `cs`), with the result count
 *   announced politely;
 * - a virtualised list of the campus's programs in server order, the
 *   current pick checked, a tap picks and the caller closes; the minor
 *   picker keeps the chosen major's row, disabled, with a quiet note; a
 *   clear row (`no major`, `no minor`) at the top when offered;
 * - an empty search says `nothing called "…"` and offers to suggest it;
 * - `don't see yours? suggest a major` at the end of the list, always. The
 *   suggestion form sits in the same sheet (`suggest_program`); it never
 *   changes the profile, and after sending it returns to the list with a
 *   neutral thanks and a nudge to pick the closest one for now.
 *
 * Why a tall sheet and not a pushed screen: both callers keep the pick in
 * local state (the editor's unsaved draft, onboarding's step), which a
 * sheet over the screen keeps with no route params or shared store. It is
 * in-tree, not a `SheetModal`, because it holds text fields (see
 * `ui/Sheet.tsx`): the panel fills the screen below the status bar and
 * shrinks above the keyboard (`KeyboardSpacer`), and the list has
 * `flex: 1` inside it, so it scrolls on Android rather than being clipped.
 * Android's back button steps back from the form, then closes the sheet.
 */
export function ProgramPickerSheet({
  kind,
  title,
  programs,
  selectedId,
  majorId = null,
  onPick,
  onDismiss,
  clearLabel,
  testID,
}: ProgramPickerSheetProps) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'list' | 'suggest'>('list');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ message: string; listed: ProgramRef | null } | null>(null);
  const [sent, setSent] = useState(false);

  const searching = isSearching(query);
  const options = useMemo(
    // `undecided` is a major only: the minor list leaves it out.
    () => programOptions(programsForKind(programs, kind), query, { selectedId, majorId: kind === 'minor' ? majorId : null }),
    [programs, query, selectedId, majorId, kind]
  );
  const clearRow = showClearRow(clearLabel, query);

  // Announce the result count once typing pauses (not on every keystroke).
  useEffect(() => {
    if (!searching) return;
    const timer = setTimeout(() => AccessibilityInfo.announceForAccessibility?.(resultCountText(options.length)), 700);
    return () => clearTimeout(timer);
  }, [searching, options.length]);

  function openSuggest(prefill: string) {
    setDraft(suggestionFromQuery(prefill));
    setError(null);
    setMode('suggest');
  }

  function backToList(nextQuery?: string) {
    setError(null);
    setMode('list');
    if (nextQuery !== undefined) setQuery(nextQuery);
  }

  // Android's back button: out of the form first, then the sheet.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (mode === 'suggest') backToList();
      else onDismiss();
      return true;
    });
    return () => sub.remove();
  });

  async function send() {
    const label = draft.trim();
    if (sending || label.length === 0) return;
    // Already offered: no need to ask the server, and the row can be shown.
    const listed = findListedProgram(programs, label);
    if (listed) {
      setError({ message: new ProgramSuggestionError('listed').message, listed });
      return;
    }
    setSending(true);
    setError(null);
    try {
      await suggestProgram(label, kind);
      setSent(true);
      setDraft('');
      backToList('');
      AccessibilityInfo.announceForAccessibility?.(SENT_LINE);
    } catch (err) {
      setError({ message: suggestionErrorMessage(err), listed: null });
    } finally {
      setSending(false);
    }
  }

  const onRowPress = useCallback((program: ProgramRef) => onPick(program), [onPick]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ProgramOption>) => (
      <ProgramRow option={item} onPress={onRowPress} testID={`${testID}-${item.program.id}`} />
    ),
    [onRowPress, testID]
  );

  const heading = mode === 'suggest' ? `suggest a ${kind}` : (title ?? `your ${kind}`);

  return (
    <Sheet tall onDismiss={onDismiss} testID={testID}>
      <View style={styles.header}>
        <Text variant="titleLg" accessibilityRole="header" style={styles.flex} numberOfLines={1}>
          {heading}
        </Text>
        <Pressable
          testID={`${testID}-close`}
          accessibilityRole="button"
          accessibilityLabel="close"
          onPress={onDismiss}
          hitSlop={8}
          style={styles.close}
        >
          <XIcon size={18} color={colors.inkSoft} />
        </Pressable>
      </View>

      {mode === 'list' ? (
        <>
          <View style={styles.searchBlock}>
            <View style={styles.search}>
              <SearchIcon size={18} color={colors.inkSoft} />
              <TextInput
                testID={`${testID}-search`}
                value={query}
                onChangeText={setQuery}
                placeholder={`search ${kind}s`}
                placeholderTextColor={colors.subtle}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                accessibilityLabel={`search ${kind}s`}
                style={styles.searchInput}
              />
              {query.length > 0 ? (
                <Pressable
                  testID={`${testID}-search-clear`}
                  accessibilityRole="button"
                  accessibilityLabel="clear search"
                  onPress={() => setQuery('')}
                  hitSlop={8}
                >
                  <XIcon size={16} color={colors.inkSoft} />
                </Pressable>
              ) : null}
            </View>
            {searching ? (
              <Text
                variant="micro"
                color={colors.inkSoft}
                testID={`${testID}-count`}
                accessibilityLiveRegion="polite"
              >
                {resultCountText(options.length)}
              </Text>
            ) : null}
          </View>

          <FlatList
            testID={`${testID}-list`}
            style={styles.flex}
            data={options}
            keyExtractor={(item) => item.program.id}
            renderItem={renderItem}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            initialNumToRender={16}
            maxToRenderPerBatch={16}
            windowSize={9}
            ListHeaderComponent={
              <>
                {sent ? (
                  <View style={styles.sent} testID={`${testID}-sent`} accessibilityLiveRegion="polite">
                    <Text variant="labelLg">{SENT_LINE}</Text>
                    <Text variant="micro" color={colors.inkSoft}>
                      {SENT_NOTE}
                    </Text>
                  </View>
                ) : null}
                {clearRow && clearLabel ? (
                  <ClearRow
                    label={clearLabel}
                    selected={selectedId === null}
                    onPress={() => onPick(null)}
                    testID={`${testID}-none`}
                  />
                ) : null}
              </>
            }
            ListEmptyComponent={
              searching ? (
                <View style={styles.empty} testID={`${testID}-empty`}>
                  <Text variant="bodyMedium" color={colors.inkSoft}>
                    {`nothing called "${query.trim()}"`}
                  </Text>
                  <Button
                    testID={`${testID}-empty-suggest`}
                    label={`suggest it as a ${kind}`}
                    variant="ghost"
                    fullWidth={false}
                    onPress={() => openSuggest(query)}
                  />
                </View>
              ) : (
                <Text variant="body" color={colors.inkSoft} style={styles.empty} testID={`${testID}-empty`}>
                  no programs are listed for your campus yet.
                </Text>
              )
            }
            ListFooterComponent={
              <View style={styles.footer}>
                <Text variant="micro" color={colors.inkSoft}>
                  don&apos;t see yours?
                </Text>
                <Pressable
                  testID={`${testID}-suggest`}
                  accessibilityRole="button"
                  onPress={() => openSuggest(searching ? query : '')}
                  hitSlop={8}
                >
                  <Text variant="labelLg" color={colors.signalDeep}>
                    {`suggest a ${kind}`}
                  </Text>
                </Pressable>
              </View>
            }
          />
        </>
      ) : (
        <ScrollView style={styles.flex} contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
          <Text variant="helper" color={colors.inkSoft}>
            {`we look at every suggestion before it joins the list. it won't change your profile yet.`}
          </Text>
          <Input
            testID={`${testID}-suggest-label`}
            label={`name of the ${kind}`}
            value={draft}
            onChangeText={(text) => {
              setDraft(text);
              if (error) setError(null);
            }}
            placeholder={kind === 'major' ? 'for example, marine biology' : 'for example, spanish'}
            maxLength={PROGRAM_SUGGESTION_MAX_LENGTH}
            autoCapitalize="none"
            autoFocus={draft.length === 0}
            error={error?.message}
            helper={`${draft.length} of ${PROGRAM_SUGGESTION_MAX_LENGTH}`}
            returnKeyType="send"
            onSubmitEditing={send}
          />
          {error?.listed ? (
            <Button
              testID={`${testID}-suggest-show`}
              label="show it in the list"
              variant="secondary"
              onPress={() => backToList(error.listed!.label)}
            />
          ) : null}
          <Button
            testID={`${testID}-suggest-send`}
            label="send suggestion"
            onPress={send}
            loading={sending}
            disabled={sending || draft.trim().length === 0}
          />
          <Button testID={`${testID}-suggest-back`} label="back to the list" variant="ghost" onPress={() => backToList()} />
        </ScrollView>
      )}
    </Sheet>
  );
}

/** The thanks after a suggestion is sent. */
const SENT_LINE = "thanks. we'll take a look.";
/** What sending did and did not do, in one line. */
const SENT_NOTE = "it doesn't change your profile yet. pick the closest one for now.";

/** A refused suggestion's line: the mapped refusal, else the generic line (never the server's text). */
function suggestionErrorMessage(err: unknown): string {
  return err instanceof ProgramSuggestionError ? err.message : FIELD_ERROR_FALLBACK;
}

const ProgramRow = memo(function ProgramRow({
  option,
  onPress,
  testID,
}: {
  option: ProgramOption;
  onPress: (program: ProgramRef) => void;
  testID: string;
}) {
  const { program, selected, disabled } = option;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={disabled ? `${program.label}, your major` : program.label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={() => onPress(program)}
      style={({ pressed }) => [styles.row, pressed && !disabled && styles.pressed]}
    >
      <Text variant="bodyMedium" color={disabled ? colors.inkDisabled : colors.ink} style={styles.flex}>
        {program.label}
      </Text>
      {disabled ? (
        <Text variant="micro" color={colors.inkSoft} testID={`${testID}-note`}>
          your major
        </Text>
      ) : null}
      <View style={styles.check}>{selected ? <CheckIcon size={18} color={colors.signalDeep} /> : null}</View>
    </Pressable>
  );
});

function ClearRow({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Text variant="bodyMedium" color={colors.inkSoft} style={styles.flex}>
        {label}
      </Text>
      <View style={styles.check}>{selected ? <CheckIcon size={18} color={colors.signalDeep} /> : null}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.mdLg },
  close: { minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  searchBlock: { gap: spacing.sm },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smMd,
    backgroundColor: colors.paperRaised,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
  },
  searchInput: { flex: 1, paddingVertical: spacing.smMd, fontSize: 15, color: colors.ink },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smMd,
    minHeight: ROW_HEIGHT,
    paddingVertical: spacing.smMd,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
  },
  check: { width: 24, alignItems: 'flex-end' },
  pressed: { opacity: 0.6 },
  sent: {
    gap: spacing.xs,
    backgroundColor: colors.paperTint,
    borderRadius: radii.card,
    padding: spacing.lg,
    marginBottom: spacing.smMd,
  },
  empty: { alignItems: 'flex-start', gap: spacing.smMd, paddingVertical: spacing.lg },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.smMd,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
    minHeight: 44,
  },
  form: { gap: spacing.lg, paddingBottom: spacing.lg },
});
