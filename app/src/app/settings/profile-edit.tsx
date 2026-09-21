import { useEffect, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { me } from '../../api/me';
import {
  deleteProfilePhoto,
  listMyPhotos,
  signedPhotoUrls,
  uploadProfilePhoto,
  type UserPhotoRow,
} from '../../api/photos';
import { getUserTags, listTagsForCampus, setUserTags, type Tag } from '../../api/tags';
import { getGradYear, getStatusLine, updateProfile } from '../../api/profile';
import { mapSupabaseError } from '../../api/errors';
import { MAX_TAGS, validateGradYear, validateStatusLine } from '../../onboarding/validation';
import { PROFILE_PHOTO_POSITIONS, type ProfilePhotoPosition } from '../../photos/path';
import { tintForPhoto } from '../../photos/tint';
import { TintedPlaceholder } from '../../photos/TintedPlaceholder';
import { ChipPicker } from '../../settings/ChipPicker';
import { Badge, Button, Header, Input, Sheet, Text, type BadgeTone } from '../../ui';
import { colors, radii, shadows, spacing } from '../../theme/tokens';

type SelectedAsset = { position: ProfilePhotoPosition; uri: string; width: number; height: number };

const MODERATION_LABEL: Record<string, string> = {
  pending: 'under review',
  ok: 'visible',
  removed: 'removed',
};
const MODERATION_TONE: Record<string, BadgeTone> = {
  pending: 'neutral',
  ok: 'success',
  removed: 'neutral',
};

/**
 * `/settings/profile-edit` — `Me.html`'s "edit photos & tags" chip, disabled
 * until this build (`(tabs)/settings.tsx`'s own doc comment on that chip).
 * No dedicated mockup covers post-onboarding re-editing (the design only
 * shows the chip's *entry point*, not a detail screen), so this is
 * assembled from the closest existing patterns per the task brief:
 * `Onb-Photos.html`'s three-slot grid (`(onboarding)/photo.tsx`),
 * `Onb-Status.html`'s tag-chip field (`(onboarding)/tags.tsx`, `ChipPicker`
 * from `settings/card.tsx`), and its status-line field
 * (`(onboarding)/status.tsx`) plus grad year (`(onboarding)/name.tsx`).
 *
 * Three independently-saved sections, matching `settings/card.tsx`'s own
 * per-mutation save pattern rather than one combined submit:
 *
 * - **Photos** — tap a slot to replace (library or camera) or remove.
 *   `user_photos_guard()` resets `moderation_state` to `pending` server-side
 *   whenever `storage_path` changes (migration
 *   `20260918000002_core_schema.sql`), and `is_grid_visible()` requires an
 *   `ok` photo at position 0 — so replacing the main photo takes the caller
 *   off the grid until it's re-approved. Replacing position 0 when a photo
 *   already sits there shows a confirm sheet stating that plainly before
 *   uploading; positions 1-2 have no such gate (they never affect
 *   `is_grid_visible`) and upload immediately. A first-ever position-0
 *   upload (no existing row) also skips the sheet — the caller is already
 *   off the grid with nothing to lose by uploading. Remove deletes the
 *   storage object then the row (`deleteProfilePhoto`, added to
 *   `api/photos.ts` for this screen) and is optimistic, rolling back the
 *   local slot on failure.
 * - **Tags** — `ChipPicker` (0-3, campus + global tags), same shape as
 *   `(onboarding)/tags.tsx`.
 * - **Status & grad year** — `Input`s mirroring `(onboarding)/status.tsx`
 *   and `name.tsx`'s grad-year field, one `updateProfile` call.
 *
 * Every save button (three total) uses the generic refusal copy via
 * `mapSupabaseError`, matching `settings/card.tsx`/`settings/identity.tsx`'s
 * own error-rendering convention exactly (a second `mapSupabaseError` pass
 * over an already-mapped error, intentional — see those screens' error
 * handling, unchanged here). Chip/text-field edits reflect instantly in
 * local state before either round-trip resolves — "optimistic" in the same
 * sense those two screens already use the word, not a distinct pattern
 * invented for this screen.
 *
 * **No reordering.** Position is part of `user_photos`' own unique key
 * (`unique (user_id, position)`) and there is no swap RPC — a drag-to-reorder
 * would need two sequential updates through a spare temp position with no
 * server-side atomicity, which is a real feature, not a simple wiring job.
 * Skipped per the task brief's own "skip and say so" instruction.
 */
export default function ProfileEditScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [campusId, setCampusId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // --- photos ---------------------------------------------------------
  const [photos, setPhotos] = useState<UserPhotoRow[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [activeSlot, setActiveSlot] = useState<ProfilePhotoPosition | null>(null);
  const [pendingUpload, setPendingUpload] = useState<SelectedAsset | null>(null);
  const [uploadingPosition, setUploadingPosition] = useState<ProfilePhotoPosition | null>(null);
  const [removingPosition, setRemovingPosition] = useState<ProfilePhotoPosition | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // --- tags -------------------------------------------------------------
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagsSaving, setTagsSaving] = useState(false);
  const [tagsSaved, setTagsSaved] = useState(false);
  const [tagsError, setTagsError] = useState<string | null>(null);

  // --- status / grad year ------------------------------------------------
  const [statusLine, setStatusLine] = useState('');
  const [gradYear, setGradYear] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const meResult = await me();
        const [photoRows, userTags, statusValue, gradYearValue] = await Promise.all([
          listMyPhotos(),
          getUserTags(),
          getStatusLine(),
          getGradYear(),
        ]);
        const tagList = await listTagsForCampus(meResult?.campus_id ?? null);
        if (cancelled) return;

        setUserId(meResult?.id ?? null);
        setCampusId(meResult?.campus_id ?? null);
        setPhotos(photoRows);
        setTags(tagList);
        setSelectedTags([...userTags].sort((a, b) => a.position - b.position).map((t) => t.tag_id));
        setStatusLine(statusValue ?? '');
        setGradYear(gradYearValue != null ? String(gradYearValue) : '');

        const paths = photoRows.map((p) => p.storage_path);
        if (paths.length > 0) setPhotoUrls(await signedPhotoUrls(paths));
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

  // --- photo actions ------------------------------------------------------

  async function pickForSlot(position: ProfilePhotoPosition, source: 'library' | 'camera') {
    setActiveSlot(null);
    setPhotoError(null);

    const permission =
      source === 'library'
        ? await ImagePicker.requestMediaLibraryPermissionsAsync()
        : await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setPhotoError(
        source === 'library' ? 'Allow photo library access to add a photo.' : 'Allow camera access to take a photo.'
      );
      return;
    }

    const result =
      source === 'library'
        ? await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 })
        : await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 1 });
    if (result.canceled) return;

    const asset = result.assets[0];
    const selected: SelectedAsset = { position, uri: asset.uri, width: asset.width, height: asset.height };

    const replacingMain = position === 0 && photos.some((p) => p.position === 0);
    if (replacingMain) {
      setPendingUpload(selected);
      return;
    }
    await doUpload(selected);
  }

  async function doUpload({ position, uri, width, height }: SelectedAsset) {
    setUploadingPosition(position);
    setPhotoError(null);
    try {
      const row = await uploadProfilePhoto({ position, uri, width, height });
      setPhotos((prev) => [...prev.filter((p) => p.position !== position), row]);
      const urls = await signedPhotoUrls([row.storage_path]);
      setPhotoUrls((prev) => ({ ...prev, ...urls }));
    } catch (error) {
      setPhotoError(mapSupabaseError(error).message);
    } finally {
      setUploadingPosition(null);
      setPendingUpload(null);
    }
  }

  async function removeSlot(position: ProfilePhotoPosition) {
    setActiveSlot(null);
    setPhotoError(null);
    const previous = photos;
    setRemovingPosition(position);
    setPhotos((prev) => prev.filter((p) => p.position !== position)); // optimistic
    try {
      await deleteProfilePhoto(position);
    } catch (error) {
      setPhotos(previous); // rollback
      setPhotoError(mapSupabaseError(error).message);
    } finally {
      setRemovingPosition(null);
    }
  }

  // --- tags/status/grad-year actions --------------------------------------

  async function saveTags() {
    setTagsSaving(true);
    setTagsError(null);
    setTagsSaved(false);
    try {
      await setUserTags(selectedTags);
      setTagsSaved(true);
    } catch (error) {
      setTagsError(mapSupabaseError(error).message);
    } finally {
      setTagsSaving(false);
    }
  }

  const statusError = statusLine.length > 0 ? validateStatusLine(statusLine) : null;
  const parsedGradYear = gradYear.trim().length > 0 ? Number(gradYear.trim()) : null;
  const gradYearError = gradYear.trim().length > 0 ? validateGradYear(parsedGradYear) : null;

  async function saveProfile() {
    if (statusError || gradYearError) return;
    setProfileSaving(true);
    setProfileError(null);
    setProfileSaved(false);
    const trimmedStatus = statusLine.trim();
    try {
      await updateProfile({
        status_line: trimmedStatus.length > 0 ? trimmedStatus : null,
        grad_year: parsedGradYear,
      });
      setProfileSaved(true);
    } catch (error) {
      setProfileError(mapSupabaseError(error).message);
    } finally {
      setProfileSaving(false);
    }
  }

  if (!loaded) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.center} testID="profile-edit-loading">
          <ActivityIndicator size="large" color={colors.ink} />
        </View>
      </SafeAreaView>
    );
  }

  const activeSlotPhoto = activeSlot !== null ? photos.find((p) => p.position === activeSlot) ?? null : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} testID="profile-edit-screen">
        <Header title="edit photos & tags" titleSize={26} onBack={() => router.back()} />

        {loadError ? (
          <Text variant="helper" color={colors.danger} testID="profile-edit-load-error">
            {loadError}
          </Text>
        ) : null}

        <View style={styles.section}>
          <Text variant="rowLabel">photos</Text>
          <Text variant="helper">this is how you look on the grid</Text>
          <View style={styles.photoGrid}>
            {PROFILE_PHOTO_POSITIONS.map((position) => {
              const photo = photos.find((p) => p.position === position) ?? null;
              const url = photo ? photoUrls[photo.storage_path] : undefined;
              const tint = photo?.tint ?? (userId ? tintForPhoto(userId, position) : colors.avatarTints[position]);
              const busy = uploadingPosition === position || removingPosition === position;

              return (
                <Pressable
                  key={position}
                  testID={`profile-edit-photo-${position}`}
                  accessibilityRole="button"
                  disabled={busy}
                  style={styles.tile}
                  onPress={() => setActiveSlot(position)}
                >
                  {url ? (
                    <Image
                      testID={`profile-edit-photo-${position}-image`}
                      source={{ uri: url }}
                      style={styles.tileImage}
                    />
                  ) : (
                    <TintedPlaceholder
                      tint={tint}
                      pending={photo?.moderation_state === 'pending'}
                      testID={`profile-edit-photo-${position}-placeholder`}
                    />
                  )}
                  {photo ? (
                    <Badge
                      testID={`profile-edit-photo-${position}-badge`}
                      label={MODERATION_LABEL[photo.moderation_state] ?? photo.moderation_state}
                      tone={MODERATION_TONE[photo.moderation_state] ?? 'neutral'}
                      style={styles.badge}
                    />
                  ) : null}
                  {busy ? (
                    <View style={StyleSheet.absoluteFill}>
                      <ActivityIndicator
                        testID={`profile-edit-photo-${position}-busy`}
                        color={colors.ink}
                        style={StyleSheet.absoluteFill}
                      />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          {photoError ? (
            <Text variant="helper" color={colors.danger} testID="profile-edit-photo-error">
              {photoError}
            </Text>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text variant="rowLabel">tags</Text>
          <Text variant="helper">{`pick up to ${MAX_TAGS} — these show on your tile`}</Text>
          <ChipPicker
            testID="profile-edit-tags"
            options={tags.map((t) => t.id)}
            selected={selectedTags}
            maxItems={MAX_TAGS}
            labelFor={(id) => tags.find((t) => t.id === id)?.label ?? id}
            onChange={setSelectedTags}
          />
          {tagsError ? (
            <Text variant="helper" color={colors.danger} testID="profile-edit-tags-error">
              {tagsError}
            </Text>
          ) : null}
          {tagsSaved && !tagsSaving ? (
            <Text variant="helper" color={colors.success} testID="profile-edit-tags-saved">
              Saved
            </Text>
          ) : null}
          <Button testID="profile-edit-tags-save" label="Save tags" loading={tagsSaving} onPress={saveTags} />
        </View>

        <View style={styles.section}>
          <Text variant="rowLabel">status & grad year</Text>
          <Input
            testID="profile-edit-status"
            label="status line"
            multiline
            maxLength={200}
            value={statusLine}
            onChangeText={(v) => {
              setStatusLine(v);
              setProfileSaved(false);
            }}
          />
          {statusError ? (
            <Text variant="helper" color={colors.danger} testID="profile-edit-status-error">
              {statusError}
            </Text>
          ) : null}
          <Input
            testID="profile-edit-grad-year"
            label="grad year"
            placeholder="Grad year (optional)"
            keyboardType="number-pad"
            value={gradYear}
            onChangeText={(v) => {
              setGradYear(v);
              setProfileSaved(false);
            }}
          />
          {gradYearError ? (
            <Text variant="helper" color={colors.danger} testID="profile-edit-grad-year-error">
              {gradYearError}
            </Text>
          ) : null}
          {profileError ? (
            <Text variant="helper" color={colors.danger} testID="profile-edit-profile-error">
              {profileError}
            </Text>
          ) : null}
          {profileSaved && !profileSaving ? (
            <Text variant="helper" color={colors.success} testID="profile-edit-profile-saved">
              Saved
            </Text>
          ) : null}
          <Button
            testID="profile-edit-profile-save"
            label="Save"
            loading={profileSaving}
            disabled={!!statusError || !!gradYearError}
            onPress={saveProfile}
          />
        </View>
      </ScrollView>

      {activeSlot !== null ? (
        <Sheet testID="profile-edit-slot-sheet" onDismiss={() => setActiveSlot(null)}>
          <Text variant="titleLg">{`position ${activeSlot + 1} photo`}</Text>
          <Button
            testID="profile-edit-slot-library"
            label="Choose from library"
            variant="secondary"
            onPress={() => pickForSlot(activeSlot, 'library')}
          />
          <Button
            testID="profile-edit-slot-camera"
            label="Take a photo"
            variant="secondary"
            onPress={() => pickForSlot(activeSlot, 'camera')}
          />
          {activeSlotPhoto ? (
            <Button
              testID="profile-edit-slot-remove"
              label="Remove photo"
              variant="destructive"
              onPress={() => removeSlot(activeSlot)}
            />
          ) : null}
          <Button
            testID="profile-edit-slot-cancel"
            label="Cancel"
            variant="ghost"
            onPress={() => setActiveSlot(null)}
          />
        </Sheet>
      ) : null}

      {pendingUpload ? (
        <Sheet testID="profile-edit-confirm-sheet" onDismiss={() => setPendingUpload(null)}>
          <Text variant="titleLg">off the grid for a bit</Text>
          <Text variant="helper">
            Replacing your main photo takes you off the grid until it&apos;s reviewed and approved again.
          </Text>
          <Button
            testID="profile-edit-confirm-continue"
            label="Replace photo"
            loading={uploadingPosition === pendingUpload.position}
            onPress={() => doUpload(pendingUpload)}
          />
          <Button
            testID="profile-edit-confirm-cancel"
            label="Cancel"
            variant="ghost"
            disabled={uploadingPosition === pendingUpload.position}
            onPress={() => setPendingUpload(null)}
          />
        </Sheet>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { paddingHorizontal: spacing.lgXl, paddingBottom: spacing.huge, gap: spacing.xxl },
  section: { gap: spacing.smMd },
  photoGrid: { flexDirection: 'row', gap: spacing.md },
  tile: {
    flex: 1,
    aspectRatio: 4 / 5,
    borderRadius: radii.lg,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: colors.surface,
    ...shadows.sm,
  },
  tileImage: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  badge: { position: 'absolute', top: 8, left: 8 },
});
