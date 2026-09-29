import { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Chip, ChipGroup, RowCard, SectionLabel, SheetModal, SettingsRow, Text } from '../../ui';
import { ChevronRightIcon, PencilIcon, PlusIcon } from '../../ui/icons';
import { TintedPlaceholder } from '../../photos/TintedPlaceholder';
import { ChipPicker } from '../../settings/ChipPicker';
import { sectionWeight, type ProfileCompletionInput } from '../../profile/completion';
import { PLACE_LINE_HOURS, PROMPTS_MAX } from '../../profile/fields';
import { GOAL_LABELS, OFFERED_GOAL_OPTIONS } from '../../profile/goalLabels';
import { colors, radii, spacing } from '../../theme/tokens';
import { usePrivateCardSummary, useAboutSummary } from '../card/summary';
import { useProfileEditorDraftContext } from './ProfileEditorDraftContext';
import { useMyPhotos } from './useMyPhotos';
import type { UserGoal } from './useProfileEditorDraft';
import type { UseProfileEditorDraftResult } from './useProfileEditorDraft';

/** Brief's literal 3-up photo-tile radius (18) — no exact existing token (`radii.tile` is 20, `radii.lg` is 22). */
const PHOTO_TILE_RADIUS = 18;

function completionInputFrom(draftState: UseProfileEditorDraftResult): ProfileCompletionInput {
  return {
    photoCount: draftState.photoCount,
    hasStatus: draftState.draft.statusLine.trim().length > 0,
    hasHereFor: draftState.draft.goals.length > 0,
    hasTags: draftState.draft.tagIds.length > 0,
  };
}

function PhotosSection() {
  const draftState = useProfileEditorDraftContext();
  const { photos, urls } = useMyPhotos();
  const weight = sectionWeight('photos', completionInputFrom(draftState));

  function openPhotos() {
    router.push('/profile-editor/photos' as never);
  }

  return (
    <View style={styles.section}>
      <SectionLabel
        testID="editor-section-photos"
        label="photos"
        signalDot={weight > 0}
        weight={weight > 0 ? weight : undefined}
      />
      <View style={styles.photoGrid}>
        {[0, 1, 2].map((i) => {
          const photo = photos[i];

          if (photo) {
            const url = urls[photo.storage_path];
            return (
              <Pressable
                key={i}
                testID={`editor-photo-tile-${i}`}
                accessibilityRole="button"
                accessibilityLabel={i === 0 ? 'photo 1, on the grid' : `photo ${i + 1}`}
                style={styles.photoTile}
                onPress={openPhotos}
              >
                {url ? (
                  <Image testID={`editor-photo-tile-${i}-image`} source={{ uri: url }} style={styles.photoTileImage} />
                ) : (
                  <TintedPlaceholder
                    tint={photo.tint ?? colors.avatarTints[i]}
                    pending={photo.moderation_state === 'pending'}
                  />
                )}
                <View style={styles.pencilBadge}>
                  <PencilIcon size={14} color={colors.ink} />
                </View>
                {i === 0 ? (
                  <View style={styles.onGridPill}>
                    <Text variant="micro" color={colors.onDark}>
                      on the grid
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          }

          const isNextEmpty = i === photos.length;
          return (
            <Pressable
              key={i}
              testID={`editor-photo-tile-${i}`}
              accessibilityRole="button"
              accessibilityLabel="add a photo"
              style={styles.photoTileEmpty}
              onPress={openPhotos}
            >
              <PlusIcon size={22} color={colors.inkFaint} />
              {isNextEmpty ? (
                <View style={styles.plusBadge} testID="editor-photo-add-badge">
                  <PlusIcon size={16} color={colors.onDark} />
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <Text variant="micro" color={colors.inkSoft}>
        tap to edit, drag to reorder. the first one is your tile.
      </Text>
    </View>
  );
}

function StatusSection() {
  const draftState = useProfileEditorDraftContext();
  const weight = sectionWeight('status', completionInputFrom(draftState));
  const hasStatus = draftState.draft.statusLine.trim().length > 0;

  return (
    <View style={styles.section}>
      <SectionLabel
        testID="editor-section-status"
        label="status"
        signalDot={weight > 0}
        weight={weight > 0 ? weight : undefined}
      />
      <RowCard>
        <Pressable
          testID="editor-status-row"
          accessibilityRole="button"
          accessibilityLabel={hasStatus ? draftState.draft.statusLine : 'add a status'}
          style={styles.statusRow}
          onPress={() => router.push('/profile-editor/status' as never)}
        >
          <Text
            variant="bodyMedium"
            color={hasStatus ? colors.ink : colors.inkSoft}
            numberOfLines={2}
            style={styles.statusText}
          >
            {hasStatus ? draftState.draft.statusLine : 'add a status'}
          </Text>
          <ChevronRightIcon size={18} color={colors.inkFaint} />
        </Pressable>
      </RowCard>
    </View>
  );
}

/**
 * Migration 0015's three fields. None of them carries completion weight
 * (the weights are a ruling) and none gets a signal dot: they are optional,
 * and nothing here should nudge anyone into filling them in. Each row opens
 * its own pushed editor, like `status`.
 */
function FieldRow({
  testID,
  label,
  note,
  text,
  placeholder,
  route,
}: {
  testID: string;
  label: string;
  note?: string;
  text: string | null;
  placeholder: string;
  route: string;
}) {
  return (
    <View style={styles.section}>
      <SectionLabel testID={`editor-section-${testID}`} label={label} note={note} />
      <RowCard>
        <Pressable
          testID={`editor-${testID}-row`}
          accessibilityRole="button"
          accessibilityLabel={text ? `${label}: ${text}` : placeholder}
          style={styles.statusRow}
          onPress={() => router.push(route as never)}
        >
          <Text variant="bodyMedium" color={text ? colors.ink : colors.inkSoft} numberOfLines={2} style={styles.statusText}>
            {text ?? placeholder}
          </Text>
          <ChevronRightIcon size={18} color={colors.inkFaint} />
        </Pressable>
      </RowCard>
    </View>
  );
}

function PlaceSection() {
  const { draft } = useProfileEditorDraftContext();
  const place = draft.placeLine.trim();
  return (
    <FieldRow
      testID="place"
      label="where you are"
      note={`shows for ${PLACE_LINE_HOURS} hours`}
      text={place.length > 0 ? place : null}
      placeholder="add where you are right now"
      route="/profile-editor/place"
    />
  );
}

function PromptsSection() {
  const { draft } = useProfileEditorDraftContext();
  const count = draft.prompts.length;
  return (
    <FieldRow
      testID="prompts"
      label="prompts"
      note={`${count} of ${PROMPTS_MAX}`}
      text={count > 0 ? draft.prompts.map((prompt) => prompt.question).join(' · ') : null}
      placeholder="answer a prompt or two"
      route="/profile-editor/prompts"
    />
  );
}

function AroundCampusSection() {
  const { draft } = useProfileEditorDraftContext();
  const count = draft.usualPlaces.length;
  return (
    <FieldRow
      testID="usual-places"
      label="around campus"
      note="after a hi is answered"
      text={count > 0 ? draft.usualPlaces.join(', ') : null}
      placeholder="add where you usually end up"
      route="/profile-editor/usual-places"
    />
  );
}

function HereForSection() {
  const draftState = useProfileEditorDraftContext();
  const weight = sectionWeight('hereFor', completionInputFrom(draftState));

  // Ruling 7: `group` is retired — never offered — but a caller who already
  // holds it keeps seeing it (selected) until they deselect it, at which
  // point it's gone for good (it's simply not in `OFFERED_GOAL_OPTIONS`).
  const options = draftState.draft.goals.includes('group')
    ? [...OFFERED_GOAL_OPTIONS, { value: 'group' as UserGoal, label: GOAL_LABELS.group }]
    : OFFERED_GOAL_OPTIONS;

  return (
    <View style={styles.section}>
      <SectionLabel
        testID="editor-section-here-for"
        label="here for"
        signalDot={weight > 0}
        weight={weight > 0 ? weight : undefined}
        note={`${draftState.draft.goals.length} picked`}
      />
      <RowCard>
        <ChipGroup
          testID="editor-here-for"
          options={options}
          value={draftState.draft.goals}
          mode="multi"
          style={styles.chipGroupPadding}
          onChange={(next) => draftState.setGoals(next as UserGoal[])}
        />
      </RowCard>
    </View>
  );
}

function TagsSection() {
  const draftState = useProfileEditorDraftContext();
  const weight = sectionWeight('tags', completionInputFrom(draftState));
  const [pickerOpen, setPickerOpen] = useState(false);

  function tagLabel(id: string): string {
    return draftState.campusTags.find((t) => t.id === id)?.label ?? id;
  }

  return (
    <View style={styles.section}>
      <SectionLabel
        testID="editor-section-tags"
        label="tags"
        signalDot={weight > 0}
        weight={weight > 0 ? weight : undefined}
        note={`${draftState.draft.tagIds.length} of 3`}
      />
      <RowCard>
        <View style={styles.chipRow} testID="editor-tags-selected">
          {draftState.draft.tagIds.map((id) => (
            <Chip key={id} label={tagLabel(id)} selected tone="tint" />
          ))}
          <Chip testID="editor-tags-change" label="change" tone="action" onPress={() => setPickerOpen(true)} />
        </View>
      </RowCard>

      {/* A `SheetModal`, not an in-tree `Sheet`: this section sits inside
          the editor's ScrollView, so an in-tree sheet's dim would only cover
          the tags section itself. */}
      {pickerOpen ? (
        <SheetModal testID="editor-tags-sheet" onDismiss={() => setPickerOpen(false)}>
          <Text variant="titleLg">tags</Text>
          <ChipPicker
            testID="editor-tags-picker"
            options={draftState.campusTags.map((t) => t.id)}
            selected={draftState.draft.tagIds}
            maxItems={3}
            labelFor={tagLabel}
            onChange={draftState.setTagIds}
          />
          <Button testID="editor-tags-sheet-done" label="done" onPress={() => setPickerOpen(false)} />
        </SheetModal>
      ) : null}
    </View>
  );
}

function AboutSection() {
  const { isPublic } = useAboutSummary();

  return (
    <View style={styles.section}>
      <SectionLabel testID="editor-section-about" label="about you" />
      <RowCard>
        <SettingsRow
          testID="editor-about-row"
          title="about you"
          subtitle={isPublic ? 'shown on your profile' : 'hidden'}
          accessory={{ kind: 'chevron' }}
          onPress={() => router.push('/profile-editor/about' as never)}
        />
      </RowCard>
    </View>
  );
}

function PrivateCardSection() {
  const { filled, total } = usePrivateCardSummary();

  return (
    <View style={styles.section}>
      {/* No signal dot, unlike the artboard: the private card carries no
          completion weight and nobody should be nudged into filling it in
          (brief, "Completion math"). */}
      <SectionLabel testID="editor-section-private-card" label="private card" note="never on the grid" />
      <RowCard>
        <SettingsRow
          testID="editor-private-card-row"
          icon="lock"
          title="private card"
          subtitle={`${filled} of ${total} filled in`}
          accessory={{ kind: 'chevron' }}
          onPress={() => router.push('/profile-editor/private-card' as never)}
        />
      </RowCard>
    </View>
  );
}

/**
 * `ProfileEditor`'s Edit tab body (`docs/design/me-redesign/brief.md`,
 * "ProfileEditor — Edit tab"): the six sections, in the artboard's order,
 * plus the profile redesign's three (where you are, next to status because
 * it is also "right now"; prompts and around campus after tags).
 * Reads/writes the shared draft (`ProfileEditorDraftContext`) for status,
 * "here for", tags and the three new fields; photos apply immediately (not draft — see
 * `profile-editor/photos.tsx`); about-you/private-card are pure navigation
 * rows into the other agent's own screens, their subtitles sourced from
 * `me/card/summary.ts`'s two hooks.
 */
export function EditSections() {
  return (
    <View style={styles.wrap}>
      <PhotosSection />
      <StatusSection />
      <PlaceSection />
      <HereForSection />
      <TagsSection />
      <PromptsSection />
      <AroundCampusSection />
      <AboutSection />
      <PrivateCardSection />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xl },
  section: { gap: spacing.smMd },
  photoGrid: { flexDirection: 'row', gap: spacing.smMd },
  photoTile: {
    flex: 1,
    aspectRatio: 4 / 5,
    borderRadius: PHOTO_TILE_RADIUS,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: colors.paperTint,
  },
  photoTileImage: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  photoTileEmpty: {
    flex: 1,
    aspectRatio: 4 / 5,
    borderRadius: PHOTO_TILE_RADIUS,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.dashed,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pencilBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: radii.circle,
    backgroundColor: colors.paperRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onGridPill: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    backgroundColor: colors.ink,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.smMd,
    paddingVertical: spacing.xxs,
  },
  plusBadge: {
    position: 'absolute',
    top: -10,
    right: -10,
    width: 32,
    height: 32,
    borderRadius: radii.circle,
    backgroundColor: colors.signal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.mdLg, padding: spacing.lgXl },
  statusText: { flex: 1 },
  chipGroupPadding: { padding: spacing.lgXl },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.smMd, padding: spacing.lgXl },
});
