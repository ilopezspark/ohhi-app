import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  TextInput,
  View,
  type SectionListData,
  type SectionListRenderItemInfo,
} from 'react-native';
import { MAX_TAGS, MIN_TAGS, type Tag } from '../api/tags';
import { Button, ChevronDownIcon, ChevronUpIcon, SearchIcon, Text, XIcon, useHeaderInsets } from '../ui';
import { colors, radii, spacing } from '../theme/tokens';
import {
  counterAnnouncement,
  counterText,
  ctaText,
  filterGroups,
  flipSection,
  groupCatalog,
  isSectionOpen,
  normalizeQuery,
  sectionCountText,
  toggleTag,
  type CategoryGroup,
} from './pickerModel';
import { SuggestTagSheet } from './SuggestTagSheet';

/** One category section: its group, whether it is open, and its one item (the group itself) when open. */
interface PickerSection {
  key: string;
  group: CategoryGroup;
  open: boolean;
}

/** Content column cap on wide screens (tablets, the web preview). */
const MAX_COLUMN_WIDTH = 560;

export interface TagPickerProps {
  /** `tag_catalog()`, already filtered to the campus and sorted. */
  catalog: Tag[];
  /** Picked ids, in picked order (what is saved). */
  selected: string[];
  onChange: (next: string[]) => void;
  /** The CTA is disabled below this (onboarding 3; the editor mirrors `set_my_tags`'s `min(3, held)`). */
  min: number;
  max?: number;
  /** Shown under the tray while fewer than 3 are picked (even when the CTA accepts fewer), e.g. `pick at least three.` */
  minNote?: string;
  /** `continue` in onboarding, `done` in the editor. */
  verb: 'continue' | 'done';
  onSubmit: () => void;
  submitting?: boolean;
  /** A failed save, shown above the CTA. */
  error?: string | null;
  title: string;
  /** One line under the title. */
  intro?: string;
  /** The top-left control: `back` (onboarding) or `cancel` (the editor). */
  closeLabel: 'back' | 'cancel';
  onClose: () => void;
  /** Replaces the default `cancel` / title row (onboarding passes its back + step bar; the title then shows as the headline). */
  header?: ReactNode;
  /** Rendered above the categories inside the list (onboarding's major row). */
  listHeader?: ReactNode;
  /** Labels for picked ids missing from the catalog (a held tag no longer offered). */
  fallbackLabel?: string;
  testID?: string;
}

/**
 * The full-screen tag picker (`docs/design/tags-about/brief.md` §1), one
 * component for onboarding and the editor:
 *
 * - a sticky tray at the top with the picked tags as removable chips, in
 *   picked order, and a live counter (announced to screen readers);
 * - a search field that filters across every category (case-insensitive,
 *   inside labels), with an empty state offering `suggest a tag`;
 * - category sections with a count each, the first three open and the rest
 *   collapsed until tapped; while searching every matching section is open;
 * - the CTA carries the counter (`continue · 7 of 10` / `done · 7 of 10`),
 *   disabled below the minimum; at the maximum the other chips are disabled
 *   with a quiet note;
 * - `suggest a tag` at the very bottom, which opens a small sheet that
 *   writes to the review queue and never touches the profile.
 *
 * Performance (411 chips on a mid-range Android phone): a virtualised
 * `SectionList` with one item per open category, and chips memoised on
 * their own props with a stable toggle callback, so a tap re-renders only
 * the chip that changed (and, at the cap, the ones that became disabled).
 * The whole body sits in a `KeyboardAvoidingView` (`padding` on both
 * platforms: Android is edge-to-edge, so its window no longer resizes), so
 * the search keyboard never covers the list or the CTA.
 */
export function TagPicker({
  catalog,
  selected,
  onChange,
  min,
  max = MAX_TAGS,
  minNote,
  verb,
  onSubmit,
  submitting = false,
  error,
  title,
  intro,
  closeLabel,
  onClose,
  header,
  listHeader,
  fallbackLabel = 'retired tag',
  testID = 'tag-picker',
}: TagPickerProps) {
  const [query, setQuery] = useState('');
  const [toggled, setToggled] = useState<Set<string>>(() => new Set());
  const [suggestOpen, setSuggestOpen] = useState(false);
  const insets = useHeaderInsets();

  const groups = useMemo(() => groupCatalog(catalog), [catalog]);
  const labels = useMemo(() => new Map(catalog.map((tag) => [tag.id, tag.label])), [catalog]);
  const searching = normalizeQuery(query).length > 0;
  const visibleGroups = useMemo(() => filterGroups(groups, query), [groups, query]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const atMax = selected.length >= max;
  const belowMin = selected.length < min;

  // A stable toggle for every chip: reads the latest selection through refs,
  // so the memoised chips never re-render just because the callback changed.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onToggle = useCallback(
    (id: string) => {
      const next = toggleTag(selectedRef.current, id, max);
      if (next !== selectedRef.current) onChangeRef.current(next);
    },
    [max]
  );

  // Announce the counter when it changes (not on first render).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    AccessibilityInfo.announceForAccessibility?.(counterAnnouncement(selected.length, max));
  }, [selected.length, max]);

  const sections = useMemo(
    () =>
      visibleGroups.map((group, index) => {
        const open = isSectionOpen(index, group.slug, toggled, searching);
        const data: CategoryGroup[] = open ? [group] : [];
        return { key: group.slug, group, open, data };
      }),
    [visibleGroups, toggled, searching]
  );

  const toggleSection = useCallback((slug: string) => setToggled((prev) => flipSection(prev, slug)), []);

  const renderSectionHeader = useCallback(
    ({ section }: { section: SectionListData<CategoryGroup, PickerSection> }) => (
      <SectionHeader
        group={section.group}
        open={section.open}
        countText={sectionCountText(section.group, selectedSet)}
        disabled={searching}
        onToggle={toggleSection}
        testID={`${testID}-section-${section.group.slug}`}
      />
    ),
    [selectedSet, searching, toggleSection, testID]
  );

  const renderItem = useCallback(
    ({ item }: SectionListRenderItemInfo<CategoryGroup>) => (
      <CategoryChips tags={item.tags} selected={selectedSet} atMax={atMax} onToggle={onToggle} testID={testID} />
    ),
    [selectedSet, atMax, onToggle, testID]
  );

  const empty = searching && visibleGroups.length === 0;

  return (
    <View style={styles.safe} testID={testID}>
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <View style={styles.column}>
          {/* The Me screen's heading padding (shared `useHeaderInsets`), for the default row and for onboarding's own. */}
          <View style={[styles.headerStrip, { paddingTop: insets.top, paddingHorizontal: insets.gutter }]}>
          {header ?? (
            <View style={styles.header}>
              <Pressable
                testID={`${testID}-close`}
                accessibilityRole="button"
                accessibilityLabel={closeLabel}
                onPress={onClose}
                hitSlop={8}
                style={styles.closeButton}
              >
                <Text variant="labelLg" color={colors.muted}>
                  {closeLabel}
                </Text>
              </Pressable>
              <Text variant="title" accessibilityRole="header" numberOfLines={1} style={styles.headerTitle}>
                {title}
              </Text>
              <View style={styles.closeButton} />
            </View>
          )}
          </View>

          {/* The sticky tray: outside the list, so it never scrolls away. */}
          <View style={styles.tray} testID={`${testID}-tray`}>
            {header ? (
              <Text variant="headline" accessibilityRole="header" style={styles.headline}>
                {title}
              </Text>
            ) : null}
            <View style={styles.trayTop}>
              <Text variant="helper" color={colors.inkSoft} style={styles.flex}>
                {intro ?? 'your picks, in order'}
              </Text>
              <Text
                variant="labelLg"
                color={atMax ? colors.ink : colors.inkSoft}
                testID={`${testID}-counter`}
                accessibilityLiveRegion="polite"
                accessibilityLabel={counterAnnouncement(selected.length, max)}
              >
                {counterText(selected.length, max)}
              </Text>
            </View>
            {selected.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.trayRow}
              >
                {selected.map((id) => (
                  <TrayChip key={id} id={id} label={labels.get(id) ?? fallbackLabel} onRemove={onToggle} testID={testID} />
                ))}
              </ScrollView>
            ) : (
              <Text variant="micro" color={colors.inkSoft} testID={`${testID}-tray-empty`}>
                nothing picked yet. tap a few below.
              </Text>
            )}
            {atMax ? (
              <Text variant="micro" color={colors.inkSoft} testID={`${testID}-max-note`}>
                {`that's ${max}. remove one to pick another.`}
              </Text>
            ) : selected.length < Math.max(min, MIN_TAGS) && minNote ? (
              <Text variant="micro" color={colors.inkSoft} testID={`${testID}-min-note`}>
                {minNote}
              </Text>
            ) : null}
            <View style={styles.search}>
              <SearchIcon size={18} color={colors.inkSoft} />
              <TextInput
                testID={`${testID}-search`}
                value={query}
                onChangeText={setQuery}
                placeholder="search interests"
                placeholderTextColor={colors.subtle}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                accessibilityLabel="search interests"
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
          </View>

          <SectionList<CategoryGroup, PickerSection>
            testID={`${testID}-list`}
            style={styles.flex}
            sections={sections}
            keyExtractor={(item) => item.slug}
            renderItem={renderItem}
            renderSectionHeader={renderSectionHeader}
            stickySectionHeadersEnabled={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            // Headers count as rows: enough for the three open sections on the first frame.
            initialNumToRender={10}
            maxToRenderPerBatch={3}
            windowSize={7}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={listHeader ? <View style={styles.listHeader}>{listHeader}</View> : null}
            ListEmptyComponent={
              empty ? (
                <View style={styles.empty} testID={`${testID}-empty`}>
                  <Text variant="bodyMedium" color={colors.inkSoft}>
                    no interest by that name yet.
                  </Text>
                  <Button
                    testID={`${testID}-empty-suggest`}
                    label="suggest a tag"
                    variant="ghost"
                    fullWidth={false}
                    onPress={() => setSuggestOpen(true)}
                  />
                </View>
              ) : null
            }
            ListFooterComponent={
              empty ? null : (
                <View style={styles.footer}>
                  <Text variant="micro" color={colors.inkSoft}>
                    not seeing yours?
                  </Text>
                  <Pressable
                    testID={`${testID}-suggest`}
                    accessibilityRole="button"
                    onPress={() => setSuggestOpen(true)}
                    hitSlop={8}
                  >
                    <Text variant="labelLg" color={colors.signalDeep}>
                      suggest a tag
                    </Text>
                  </Pressable>
                </View>
              )
            }
          />

          <View style={[styles.cta, { paddingBottom: Math.max(spacing.mdLg, insets.bottom + spacing.smMd) }]}>
            {error ? (
              <Text variant="helper" color={colors.danger} testID={`${testID}-error`}>
                {error}
              </Text>
            ) : null}
            <Button
              testID={`${testID}-submit`}
              label={ctaText(verb, selected.length, max)}
              onPress={onSubmit}
              loading={submitting}
              disabled={belowMin || submitting}
            />
          </View>
        </View>
      </KeyboardAvoidingView>

      {suggestOpen ? (
        <SuggestTagSheet
          initialLabel={empty ? query : ''}
          categories={groups.map(({ slug, label }) => ({ slug, label }))}
          onDismiss={() => setSuggestOpen(false)}
          testID={`${testID}-suggest-sheet`}
        />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------

const SectionHeader = memo(function SectionHeader({
  group,
  open,
  countText,
  disabled,
  onToggle,
  testID,
}: {
  group: CategoryGroup;
  open: boolean;
  countText: string;
  disabled: boolean;
  onToggle: (slug: string) => void;
  testID: string;
}) {
  return (
    <View accessibilityRole="header" style={styles.sectionHeaderWrap}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${group.label}, ${countText}`}
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        onPress={() => onToggle(group.slug)}
        style={({ pressed }) => [styles.sectionHeader, pressed && styles.pressed]}
      >
        <Text variant="sectionLabel" color={colors.muted} style={styles.sectionTitle}>
          {group.label}
        </Text>
        <Text variant="micro" color={colors.inkSoft} testID={`${testID}-count`}>
          {countText}
        </Text>
        {disabled ? null : open ? (
          <ChevronUpIcon size={16} color={colors.inkSoft} />
        ) : (
          <ChevronDownIcon size={16} color={colors.inkSoft} />
        )}
      </Pressable>
    </View>
  );
});

const CategoryChips = memo(function CategoryChips({
  tags,
  selected,
  atMax,
  onToggle,
  testID,
}: {
  tags: Tag[];
  selected: ReadonlySet<string>;
  atMax: boolean;
  onToggle: (id: string) => void;
  testID: string;
}) {
  return (
    <View style={styles.chips}>
      {tags.map((tag) => {
        const isSelected = selected.has(tag.id);
        return (
          <TagChip
            key={tag.id}
            id={tag.id}
            label={tag.label}
            selected={isSelected}
            disabled={atMax && !isSelected}
            onToggle={onToggle}
            testID={`${testID}-chip-${tag.id}`}
          />
        );
      })}
    </View>
  );
});

/** One catalog chip: a toggle button with its selected state, memoised on its own props. */
const TagChip = memo(function TagChip({
  id,
  label,
  selected,
  disabled,
  onToggle,
  testID,
}: {
  id: string;
  label: string;
  selected: boolean;
  disabled: boolean;
  onToggle: (id: string) => void;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="togglebutton"
      accessibilityLabel={label}
      accessibilityState={{ selected, checked: selected, disabled }}
      disabled={disabled}
      onPress={() => onToggle(id)}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        disabled && styles.chipDisabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text variant="caption" color={selected ? colors.onDark : colors.ink}>
        {label}
      </Text>
    </Pressable>
  );
});

function TrayChip({ id, label, onRemove, testID }: { id: string; label: string; onRemove: (id: string) => void; testID: string }) {
  return (
    <Pressable
      testID={`${testID}-tray-${id}`}
      accessibilityRole="button"
      accessibilityLabel={`remove ${label}`}
      onPress={() => onRemove(id)}
      style={({ pressed }) => [styles.trayChip, pressed && styles.pressed]}
    >
      <Text variant="caption" color={colors.onDark}>
        {label}
      </Text>
      <XIcon size={12} color={colors.onDark} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  flex: { flex: 1 },
  column: { flex: 1, width: '100%', maxWidth: MAX_COLUMN_WIDTH, alignSelf: 'center' },
  headerStrip: { paddingBottom: spacing.mdLg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.mdLg },
  closeButton: { minHeight: 44, minWidth: 56, justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center' },
  headline: { fontSize: 28, lineHeight: 31 },
  trayTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.mdLg },
  tray: {
    paddingHorizontal: spacing.lgXl,
    paddingBottom: spacing.mdLg,
    gap: spacing.smMd,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  trayRow: { gap: spacing.smMd, paddingVertical: spacing.xxs },
  trayChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.ink,
    borderRadius: radii.pill,
    paddingVertical: spacing.smMd,
    paddingLeft: spacing.mdLg,
    paddingRight: spacing.md,
    minHeight: 36,
  },
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
  listContent: { paddingHorizontal: spacing.lgXl, paddingBottom: spacing.xl },
  listHeader: { paddingTop: spacing.lgXl },
  sectionHeaderWrap: { paddingTop: spacing.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.smMd, minHeight: 44 },
  sectionTitle: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.smMd, paddingBottom: spacing.sm },
  chip: {
    borderRadius: radii.pill,
    backgroundColor: colors.tint,
    paddingVertical: 9,
    paddingHorizontal: 13,
    minHeight: 38,
    justifyContent: 'center',
  },
  chipSelected: { backgroundColor: colors.ink },
  chipDisabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
  empty: { alignItems: 'flex-start', gap: spacing.smMd, paddingTop: spacing.xl },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.smMd, paddingTop: spacing.xxl, paddingBottom: spacing.lg, minHeight: 44 },
  cta: { paddingHorizontal: spacing.lgXl, paddingTop: spacing.smMd, gap: spacing.smMd },
});
