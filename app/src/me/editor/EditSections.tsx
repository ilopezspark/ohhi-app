import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Chip, ChipGroup, RowCard, SectionLabel, SettingsRow, Text } from '../../ui';
import { ChevronRightIcon, PencilIcon, PlusIcon } from '../../ui/icons';
import { TintedPlaceholder } from '../../photos/TintedPlaceholder';
import { MAX_TAGS } from '../../api/tags';
import { aboutSummary } from '../../profile/about';
import { sectionWeight, TAGS_COMPLETE_AT, type ProfileCompletionInput } from '../../profile/completion';
import { PLACE_LINE_HOURS, PROMPTS_MAX } from '../../profile/fields';
import { GOAL_LABELS, OFFERED_GOAL_OPTIONS } from '../../profile/goalLabels';
import { colors, radii, spacing } from '../../theme/tokens';
import { IDENTITY_CARD_ROWS } from '../card/fieldLabels';
import { useIdentityCardSummaries, usePrivateCardSummary } from '../card/summary';
import { PhotoStatePill } from '../../photos/PhotoStatePill';
import type { UserPhotoRow } from '../../api/photos';
import { IDENTITY_CARD_ROUTES } from './identityCardDraft';
import { useProfileEditorDraftContext } from './ProfileEditorDraftContext';
import { gridSlotLabel, hasPhotoUnderReview, PHOTO_STATE_COPY } from './photoStates';
import { useMyPhotos } from './useMyPhotos';
import type { UserGoal } from './useProfileEditorDraft';
import type { DraftField, UseProfileEditorDraftResult } from './useProfileEditorDraft';
import { StorageImage } from '../../ui/StorageImage';

/** Brief's literal 3-up photo-tile radius (18) — no exact existing token (`radii.tile` is 20, `radii.lg` is 22). */
const PHOTO_TILE_RADIUS = 18;

function completionInputFrom(draftState: UseProfileEditorDraftResult): ProfileCompletionInput {
  return {
    photoCount: draftState.photoCount,
    hasStatus: draftState.draft.statusLine.trim().length > 0,
    hasHereFor: draftState.draft.goals.length > 0,
    tagCount: draftState.draft.tagIds.length,
  };
}

/**
 * A field's last refusal (e.g. the word filter's `that text can't be used.`),
 * shown right under that field's row. The draft keeps the text, so the
 * person opens the row and edits it; the line clears once they do.
 */
function FieldError({ field }: { field: DraftField }) {
  const { fieldErrors } = useProfileEditorDraftContext();
  const message = fieldErrors[field];
  if (!message) return null;
  return (
    <Text variant="helper" color={colors.danger} testID={`editor-field-error-${field}`}>
      {message}
    </Text>
  );
}

function PhotosSection() {
  const draftState = useProfileEditorDraftContext();
  const { photos, urls, resignUrls } = useMyPhotos();
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
            return (
              <PhotoRowTile
                key={i}
                index={i}
                photo={photo}
                url={urls[photo.storage_path]}
                onPress={openPhotos}
                onImageError={resignUrls}
              />
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
      {hasPhotoUnderReview(photos) ? (
        <Text variant="micro" color={colors.inkSoft} testID="editor-photo-review-hint">
          {PHOTO_STATE_COPY.underReviewHint}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * One filled slot of the editor's photos row. The owner sees every photo they
 * have (owner ruling): an approved one as is, a pending one with its image and
 * an "under review" pill, a removed one as a neutral tile saying so (tapping
 * opens the photos screen, where it is replaced). The first slot's pill says
 * "on the grid once approved" until that photo is approved.
 */
function PhotoRowTile({
  index,
  photo,
  url,
  onPress,
  onImageError,
}: {
  index: number;
  photo: UserPhotoRow;
  url: string | undefined;
  onPress: () => void;
  onImageError: () => void;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const state = photo.moderation_state;
  const removed = state === 'removed';
  const showImage = !removed && !!url && failedUrl !== url;
  const stateLabel = state === 'pending' ? PHOTO_STATE_COPY.underReview : null;

  return (
    <Pressable
      testID={`editor-photo-tile-${index}`}
      accessibilityRole="button"
      accessibilityLabel={
        removed
          ? `photo ${index + 1}, removed. replace it`
          : [index === 0 ? `photo 1, ${gridSlotLabel(state)}` : `photo ${index + 1}`, stateLabel].filter(Boolean).join(', ')
      }
      style={styles.photoTile}
      onPress={onPress}
    >
      {removed ? (
        <View style={styles.photoTileRemoved} testID={`editor-photo-tile-${index}-removed`}>
          <Text variant="micro" color={colors.inkSoft}>
            {PHOTO_STATE_COPY.removed}
          </Text>
        </View>
      ) : showImage ? (
        <StorageImage
          testID={`editor-photo-tile-${index}-image`}
          uri={url}
          tint={photo.tint ?? colors.avatarTints[index]}
          style={styles.photoTileImage}
          onError={() => {
            setFailedUrl(url ?? null);
            onImageError();
          }}
        />
      ) : (
        <TintedPlaceholder
          tint={photo.tint ?? colors.avatarTints[index]}
          testID={`editor-photo-tile-${index}-placeholder`}
        />
      )}
      <View style={styles.pencilBadge}>
        <PencilIcon size={14} color={colors.ink} />
      </View>
      {stateLabel ? (
        <PhotoStatePill label={stateLabel} style={styles.statePill} testID={`editor-photo-tile-${index}-under-review`} />
      ) : null}
      {index === 0 && !removed ? (
        <View style={styles.onGridPill} testID="editor-photo-tile-0-grid-pill">
          <Text variant="micro" color={colors.onDark}>
            {gridSlotLabel(state)}
          </Text>
        </View>
      ) : null}
    </Pressable>
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
      <FieldError field="statusLine" />
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
  field,
}: {
  testID: string;
  label: string;
  note?: string;
  text: string | null;
  placeholder: string;
  route: string;
  field: DraftField;
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
      <FieldError field={field} />
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
      field="placeLine"
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
      field="prompts"
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
      field="usualPlaces"
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

/**
 * Interests (migration 0018): the picked tags as chips, in picked order,
 * plus `change`, which opens the full-screen picker
 * (`/profile-editor/tags`), a pushed screen with its own scrolling,
 * category-sectioned list (the old in-sheet picker could not scroll). With
 * none picked there is a clear line and the same action.
 */
function TagsSection() {
  const draftState = useProfileEditorDraftContext();
  const weight = sectionWeight('tags', completionInputFrom(draftState));
  const count = draftState.draft.tagIds.length;
  const labels = new Map(draftState.catalog.map((tag) => [tag.id, tag.label]));

  function openPicker() {
    router.push('/profile-editor/tags' as never);
  }

  return (
    <View style={styles.section}>
      <SectionLabel
        testID="editor-section-tags"
        label="interests"
        signalDot={weight > 0}
        weight={weight > 0 ? weight : undefined}
        note={`${count} of ${MAX_TAGS}`}
      />
      <RowCard>
        <View style={styles.tagsBody}>
          {count === 0 ? (
            <Text variant="bodyMedium" color={colors.inkSoft} testID="editor-tags-empty">
              pick at least three interests. they show on your profile in the order you pick them.
            </Text>
          ) : count < TAGS_COMPLETE_AT ? (
            <Text variant="micro" color={colors.inkSoft} testID="editor-tags-few">
              three or more helps people find something to say hi about.
            </Text>
          ) : null}
          <View style={styles.chipRow} testID="editor-tags-selected">
            {draftState.draft.tagIds.map((id) => (
              <Chip key={id} label={labels.get(id) ?? 'retired tag'} selected tone="tint" />
            ))}
            <Chip
              testID="editor-tags-change"
              label={count === 0 ? 'pick interests' : 'change'}
              tone="action"
              onPress={openPicker}
            />
          </View>
        </View>
      </RowCard>
      <FieldError field="tagIds" />
    </View>
  );
}

/**
 * `about you` (migration 0018, and the owner's note that there was no
 * place to add a major, graduating year or work), then the profile
 * restructure's five public cards (reconcile.md phase 4c), in the order
 * they render on the profile: about, identity, background, lifestyle,
 * when i'm around, before you message me. `school and work` opens the about
 * editor and shows a summary of what is set; each card row opens that card's
 * editor and shows how many of its rows are filled, then who sees it (the
 * card's audience; "before you message me" is always everyone once filled).
 * It sits high on the tab, right after `here for`. No completion weight and
 * no signal dot on any of it: optional, never nagged (C8).
 */
function AboutSection() {
  const draftState = useProfileEditorDraftContext();
  const cards = useIdentityCardSummaries();
  const summary = aboutSummary(draftState.draft.about);

  return (
    <View style={styles.section}>
      <SectionLabel testID="editor-section-about" label="about you" />
      <RowCard style={styles.cardInset}>
        <SettingsRow
          testID="editor-school-work-row"
          title="school and work"
          subtitle={summary ?? 'add your major, graduating term and work'}
          accessory={{ kind: 'chevron' }}
          onPress={() => router.push('/profile-editor/school-and-work' as never)}
        />
        {IDENTITY_CARD_ROWS.map(({ card, label }) => (
          <SettingsRow
            key={card}
            testID={`editor-card-${card}-row`}
            title={label}
            subtitle={cards?.find((row) => row.card === card)?.subtitle}
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push(IDENTITY_CARD_ROUTES[card] as never)}
          />
        ))}
      </RowCard>
      <FieldError field="about" />
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
      <RowCard style={styles.cardInset}>
        <SettingsRow
          testID="editor-private-card-row"
          icon="lock"
          title="private card"
          subtitle={filled === null ? undefined : `${filled} of ${total} filled in`}
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
 * it is also "right now"; prompts and around campus after interests), and
 * migration 0018's `about you` right after `here for`, above interests, so
 * school and work is not buried at the bottom.
 * Reads/writes the shared draft (`ProfileEditorDraftContext`) for status,
 * "here for", interests, the about section and the 0015 fields; photos
 * apply immediately (not draft — see `profile-editor/photos.tsx`);
 * the five public cards and the private card are navigation rows into their
 * own screens (they save on their own), their subtitles sourced from
 * `me/card/summary.ts`.
 */
export function EditSections() {
  return (
    <View style={styles.wrap}>
      <PhotosSection />
      <StatusSection />
      <PlaceSection />
      <HereForSection />
      <AboutSection />
      <TagsSection />
      <PromptsSection />
      <AroundCampusSection />
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
  photoTileRemoved: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paperTint,
  },
  // Content-sized pills that wrap rather than run off a narrow tile (the pencil badge sits top-right).
  statePill: { position: 'absolute', top: 8, left: 8, maxWidth: '62%' },
  onGridPill: {
    position: 'absolute',
    left: 8,
    maxWidth: '88%',
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.smMd },
  tagsBody: { padding: spacing.lgXl, gap: spacing.mdLg },
  // The same 16 inset as every other row card (Me, settings), so rows with
  // and without a leading icon line up on one left edge.
  cardInset: { paddingHorizontal: spacing.lgXl },
});
