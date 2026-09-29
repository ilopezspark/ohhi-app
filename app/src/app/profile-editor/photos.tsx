import { useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { Image, Platform, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Gesture, GestureDetector, GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  addProfilePhoto,
  removeProfilePhoto,
  replaceProfilePhoto,
  setMyPhotoOrder,
  type UserPhotoRow,
} from '../../api/photos';
import { mapSupabaseError } from '../../api/errors';
import type { ProfilePhotoPosition } from '../../photos/path';
import { TintedPlaceholder } from '../../photos/TintedPlaceholder';
import { useMyPhotos } from '../../me/editor/useMyPhotos';
import {
  computeDropIndex,
  firstFreePosition,
  moveDown,
  moveItem,
  moveUp,
  orderAfterRemoval,
  takesYouOffTheGrid,
  type GridGeometry,
} from '../../me/editor/reorderPhotos';
import { queryKeys } from '../../me/queryKeys';
import { BackIcon, Button, CheckIcon, DragIcon, PencilIcon, PlusIcon, Sheet, Text, XIcon } from '../../ui';
import { colors, radii, shadows, spacing } from '../../theme/tokens';

const GRID_COLUMNS = 2;
const GRID_GAP = spacing.smMd;
const MAX_PHOTOS = 3;

type PickedAsset = { uri: string; width: number; height: number };
type PickResult = { kind: 'picked'; asset: PickedAsset } | { kind: 'cancelled' } | { kind: 'denied' };

async function pickFromLibrary(): Promise<PickResult> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return { kind: 'denied' };
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [4, 5],
    quality: 1,
  });
  if (result.canceled) return { kind: 'cancelled' };
  const asset = result.assets[0];
  return { kind: 'picked', asset: { uri: asset.uri, width: asset.width, height: asset.height } };
}

const PERMISSION_COPY = 'allow photo library access to add a photo.';

/** A change that would take the caller off the grid, parked until they confirm it. */
type OffGridConfirm = { copy: string; run: () => void };

/**
 * `EditPhotos` (`docs/design/me-redesign/brief.md`, `06-edit-photos.png`).
 * Photos are NOT part of the profile-editor draft: every change here (add,
 * replace, remove, reorder) applies immediately, because uploads go through
 * moderation whenever the editor is dismissed. Every server call goes through
 * `api/photos.ts`, which follows the migration 0011/0012 contract (fresh
 * `{user_id}/{photo_id}.jpg` names, `upsert: false`, row before object on
 * delete, reorder only through `set_my_photo_order`). The server sets every
 * new or replaced photo to `pending`; nothing here writes `moderation_state`.
 *
 * Every write is optimistic against the shared `queryKeys.me.photos` cache,
 * so this screen, the editor's photos row, Preview and Me all update
 * together, and rolls back (then refetches the truth) on failure.
 *
 * A change that would take the caller off the grid (a not-yet-approved photo
 * becoming first, by reorder, removal or replacing the first photo) asks
 * first, per the reorder contract's "the app warns before doing it".
 */
export default function EditPhotosScreen() {
  const queryClient = useQueryClient();
  const { photos, urls, isLoaded } = useMyPhotos();

  const [actionSheetIndex, setActionSheetIndex] = useState<number | null>(null);
  const [offGridConfirm, setOffGridConfirm] = useState<OffGridConfirm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [busyPhotoId, setBusyPhotoId] = useState<string | null>(null);
  const [gridWidth, setGridWidth] = useState(0);

  function onGridLayout(e: LayoutChangeEvent) {
    setGridWidth(e.nativeEvent.layout.width);
  }

  const tileWidth = gridWidth > 0 ? (gridWidth - GRID_GAP) / GRID_COLUMNS : 0;
  const tileHeight = tileWidth * 1.25; // 4:5
  const geometry: GridGeometry = {
    columns: GRID_COLUMNS,
    cellWidth: tileWidth + GRID_GAP,
    cellHeight: tileHeight + GRID_GAP,
  };

  function setPhotosCache(next: UserPhotoRow[]) {
    queryClient.setQueryData(queryKeys.me.photos, next);
  }

  function currentCache(): UserPhotoRow[] {
    return queryClient.getQueryData<UserPhotoRow[]>(queryKeys.me.photos) ?? photos;
  }

  function refetchTruth() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.me.photos });
  }

  /** Runs `run` now, or after a confirmation when `next` would take the caller off the grid. */
  function guardOffGrid(next: Pick<UserPhotoRow, 'moderation_state'>[], copy: string, run: () => void) {
    if (takesYouOffTheGrid(currentCache(), next)) {
      setOffGridConfirm({ copy, run });
      return;
    }
    run();
  }

  function requestReorder(newOrder: UserPhotoRow[]) {
    const current = currentCache();
    if (newOrder.length === current.length && newOrder.every((p, i) => p.id === current[i]?.id)) return;
    guardOffGrid(
      newOrder,
      "this photo is still in review. you'll be off the grid until it's approved.",
      () => void applyReorder(newOrder)
    );
  }

  async function applyReorder(newOrder: UserPhotoRow[]) {
    const previous = currentCache();
    setPhotosCache(newOrder);
    setError(null);
    try {
      const saved = await setMyPhotoOrder(newOrder.map((p) => p.id));
      setPhotosCache(saved);
    } catch (cause) {
      setPhotosCache(previous);
      setError(mapSupabaseError(cause).message);
      refetchTruth();
    }
  }

  function onDragDrop(fromIndex: number, toIndex: number) {
    requestReorder(moveItem(currentCache(), fromIndex, toIndex));
  }

  function requestRemove(photo: UserPhotoRow) {
    const remaining = orderAfterRemoval(currentCache(), photo.id);
    const copy =
      remaining.length === 0
        ? "with no photos you won't be on the grid."
        : "your next photo is still in review. you'll be off the grid until it's approved.";
    guardOffGrid(remaining, copy, () => void applyRemove(photo, remaining));
  }

  async function applyRemove(photo: UserPhotoRow, remaining: UserPhotoRow[]) {
    const previous = currentCache();
    setPhotosCache(remaining);
    setError(null);
    try {
      const saved = await removeProfilePhoto(
        photo.id,
        photo.storage_path,
        remaining.map((p) => p.id)
      );
      setPhotosCache(saved);
    } catch (cause) {
      // The row delete may have landed before a later step failed, so the
      // rollback is only a placeholder until the refetch reports the truth.
      setPhotosCache(previous);
      setError(mapSupabaseError(cause).message);
      refetchTruth();
    }
  }

  async function handleAdd() {
    setError(null);
    // Until the first read lands, `photos` is an empty placeholder: a slot
    // taken from it would be 0 and collide with a photo already there.
    const known = queryClient.getQueryData<UserPhotoRow[]>(queryKeys.me.photos);
    if (!known || firstFreePosition(known) === null) return;
    const picked = await pickFromLibrary();
    if (picked.kind === 'denied') {
      setError(PERMISSION_COPY);
      return;
    }
    if (picked.kind !== 'picked') return;
    // The picker is modal and can stay open a while (a focus refetch can land
    // meanwhile), so the slot comes from the cache as it is now, not as it was.
    const position = firstFreePosition(currentCache());
    if (position === null) return;
    setAddBusy(true);
    try {
      const created = await addProfilePhoto({
        position,
        uri: picked.asset.uri,
        width: picked.asset.width,
        height: picked.asset.height,
      });
      setPhotosCache([...currentCache(), created].sort((a, b) => a.position - b.position));
    } catch (cause) {
      setError(mapSupabaseError(cause).message);
      refetchTruth();
    } finally {
      setAddBusy(false);
    }
  }

  function requestReplace(photo: UserPhotoRow) {
    const current = currentCache();
    const next = current.map((p) => (p.id === photo.id ? { ...p, moderation_state: 'pending' as const } : p));
    guardOffGrid(
      next,
      "a new first photo goes to review first. you'll be off the grid until it's approved.",
      () => void applyReplace(photo)
    );
  }

  async function applyReplace(photo: UserPhotoRow) {
    setError(null);
    const picked = await pickFromLibrary();
    if (picked.kind === 'denied') {
      setError(PERMISSION_COPY);
      return;
    }
    if (picked.kind !== 'picked') return;
    setBusyPhotoId(photo.id);
    try {
      const updated = await replaceProfilePhoto({
        photoId: photo.id,
        previousStoragePath: photo.storage_path,
        position: photo.position as ProfilePhotoPosition,
        uri: picked.asset.uri,
        width: picked.asset.width,
        height: picked.asset.height,
      });
      setPhotosCache(currentCache().map((p) => (p.id === updated.id ? updated : p)));
    } catch (cause) {
      setError(mapSupabaseError(cause).message);
      refetchTruth();
    } finally {
      setBusyPhotoId(null);
    }
  }

  const activePhoto = actionSheetIndex !== null ? photos[actionSheetIndex] : null;
  const canAdd = isLoaded && photos.length < MAX_PHOTOS;

  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <SafeAreaView style={styles.safe} edges={['top']} testID="profile-editor-photos-screen">
        <View style={styles.header}>
          <Pressable
            testID="editor-photos-back"
            accessibilityRole="button"
            accessibilityLabel="back"
            onPress={() => router.back()}
            style={styles.headerBtn}
          >
            <BackIcon size={20} color={colors.ink} />
          </Pressable>
          <Text variant="title">photos</Text>
          <Pressable
            testID="editor-photos-done"
            accessibilityRole="button"
            onPress={() => router.back()}
            style={styles.headerBtnRight}
          >
            <Text variant="labelLg" color={colors.signal}>
              done
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scroll}>
          <Text variant="bodyMedium" color={colors.inkSoft} style={styles.intro}>
            hold and drag to reorder. the first one is your tile on the grid.
          </Text>

          <View style={styles.grid} onLayout={onGridLayout} testID="editor-photos-grid">
            {[0, 1, 2].map((i) => {
              const photo = photos[i];

              if (photo) {
                const url = urls[photo.storage_path];
                return (
                  <DraggableTile
                    key={photo.id}
                    index={i}
                    total={photos.length}
                    geometry={geometry}
                    width={tileWidth}
                    height={tileHeight}
                    draggable={Platform.OS !== 'web' && geometry.cellWidth > 0 && photos.length > 1}
                    onDrop={onDragDrop}
                  >
                    {url ? (
                      <Image testID={`editor-photos-tile-${i}-image`} source={{ uri: url }} style={styles.tileImage} />
                    ) : (
                      <TintedPlaceholder tint={photo.tint ?? colors.avatarTints[i]} />
                    )}

                    <View style={styles.topPills}>
                      {i === 0 ? (
                        <View style={styles.onGridPill}>
                          <Text variant="micro" color={colors.ink}>
                            on the grid
                          </Text>
                        </View>
                      ) : null}
                      {photo.moderation_state === 'pending' ? (
                        <View style={styles.statePill} testID={`editor-photos-tile-${i}-in-review`}>
                          <Text variant="micro" color={colors.ink}>
                            in review
                          </Text>
                        </View>
                      ) : null}
                      {photo.moderation_state === 'removed' ? (
                        <View style={styles.statePill} testID={`editor-photos-tile-${i}-removed`}>
                          <Text variant="micro" color={colors.danger}>
                            removed
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    <Pressable
                      testID={`editor-photos-pencil-${i}`}
                      accessibilityRole="button"
                      accessibilityLabel={`photo ${i + 1} options`}
                      style={styles.pencilBadge}
                      hitSlop={8}
                      onPress={() => setActionSheetIndex(i)}
                    >
                      {busyPhotoId === photo.id ? (
                        <Text variant="micro">…</Text>
                      ) : (
                        <PencilIcon size={14} color={colors.ink} />
                      )}
                    </Pressable>

                    {Platform.OS !== 'web' && photos.length > 1 ? (
                      <View style={styles.dragHandle} testID={`editor-photo-drag-handle-${i}`}>
                        <DragIcon size={14} color={colors.ink} />
                      </View>
                    ) : null}
                  </DraggableTile>
                );
              }

              // Nothing is offered as the next slot until the photos have loaded.
              const isNextEmpty = isLoaded && i === photos.length;
              return (
                <Pressable
                  key={`empty-${i}`}
                  testID={`editor-photos-tile-${i}`}
                  accessibilityRole="button"
                  accessibilityLabel="add a photo"
                  accessibilityState={{ disabled: !isNextEmpty || addBusy || !canAdd }}
                  style={[styles.tileEmpty, { width: tileWidth, height: tileHeight }]}
                  disabled={!isNextEmpty || addBusy || !canAdd}
                  onPress={handleAdd}
                >
                  {isNextEmpty ? (
                    <>
                      <View style={styles.plusBadgeFloat} testID="editor-photos-add-badge">
                        <PlusIcon size={16} color={colors.onDark} />
                      </View>
                      <PlusIcon size={26} color={colors.muted} />
                      <Text variant="labelLg" color={colors.muted}>
                        {addBusy ? 'uploading…' : 'add photo'}
                      </Text>
                    </>
                  ) : null}
                </Pressable>
              );
            })}

            <View style={[styles.tileInert, { width: tileWidth, height: tileHeight }]} testID="editor-photos-inert-tile">
              <Text variant="micro" color={colors.inkSoft} style={styles.inertText}>
                3 photos max. keeps everyone&apos;s grid honest.
              </Text>
            </View>
          </View>

          {error ? (
            <Text variant="helper" color={colors.danger} testID="editor-photos-error" style={styles.error}>
              {error}
            </Text>
          ) : null}

          <View style={styles.rulesCard} testID="editor-photos-rules">
            <Text variant="labelLg">what gets through review</Text>
            <RuleRow ok label="just you, face visible in the first one" />
            <RuleRow ok label="taken by you, not pulled off instagram" />
            <RuleRow label="no group shots, no nudity, no filters that hide your face" />
          </View>
        </ScrollView>
      </SafeAreaView>

      {activePhoto ? (
        <Sheet testID="editor-photo-action-sheet" onDismiss={() => setActionSheetIndex(null)}>
          <Text variant="titleLg">{`photo ${(actionSheetIndex ?? 0) + 1}`}</Text>
          <Button
            testID="editor-photo-action-replace"
            label="replace"
            variant="secondary"
            onPress={() => {
              setActionSheetIndex(null);
              requestReplace(activePhoto);
            }}
          />
          {actionSheetIndex !== 0 ? (
            <Button
              testID="editor-photo-action-make-first"
              label="make first"
              variant="secondary"
              disabled={activePhoto.moderation_state === 'removed'}
              onPress={() => {
                const index = actionSheetIndex as number;
                setActionSheetIndex(null);
                requestReorder(moveItem(currentCache(), index, 0));
              }}
            />
          ) : null}
          {actionSheetIndex !== 0 && activePhoto.moderation_state === 'removed' ? (
            <Text variant="helper" color={colors.inkSoft} testID="editor-photo-action-removed-explain">
              a removed photo cannot be your first one.
            </Text>
          ) : null}
          {Platform.OS === 'web' ? (
            <>
              <Button
                testID="editor-photo-action-move-up"
                label="move up"
                variant="secondary"
                disabled={actionSheetIndex === 0}
                onPress={() => {
                  const index = actionSheetIndex as number;
                  setActionSheetIndex(null);
                  requestReorder(moveUp(currentCache(), index));
                }}
              />
              <Button
                testID="editor-photo-action-move-down"
                label="move down"
                variant="secondary"
                disabled={actionSheetIndex === photos.length - 1}
                onPress={() => {
                  const index = actionSheetIndex as number;
                  setActionSheetIndex(null);
                  requestReorder(moveDown(currentCache(), index));
                }}
              />
            </>
          ) : null}
          <Button
            testID="editor-photo-action-remove"
            label="remove"
            variant="destructive"
            onPress={() => {
              setActionSheetIndex(null);
              requestRemove(activePhoto);
            }}
          />
          <Button
            testID="editor-photo-action-cancel"
            label="cancel"
            variant="ghost"
            onPress={() => setActionSheetIndex(null)}
          />
        </Sheet>
      ) : null}

      {offGridConfirm ? (
        <Sheet testID="editor-photo-pending-confirm-sheet" onDismiss={() => setOffGridConfirm(null)}>
          <Text variant="titleLg">off the grid for a bit</Text>
          <Text variant="bodyMedium" testID="editor-photo-pending-confirm-copy">
            {offGridConfirm.copy}
          </Text>
          <Button
            testID="editor-photo-pending-confirm-continue"
            label="continue"
            onPress={() => {
              const next = offGridConfirm;
              setOffGridConfirm(null);
              next.run();
            }}
          />
          <Button
            testID="editor-photo-pending-confirm-cancel"
            label="cancel"
            variant="ghost"
            onPress={() => setOffGridConfirm(null)}
          />
        </Sheet>
      ) : null}
    </GestureHandlerRootView>
  );
}

function RuleRow({ ok = false, label }: { ok?: boolean; label: string }) {
  return (
    <View style={styles.ruleRow}>
      {ok ? <CheckIcon size={16} color={colors.sage} /> : <XIcon size={16} color={colors.danger} />}
      <Text variant="bodyMedium" style={styles.ruleText}>
        {label}
      </Text>
    </View>
  );
}

/**
 * One filled photo tile that can be long-pressed and dragged to a new slot
 * (brief: "long-press to drag-reorder"). The whole tile follows the finger;
 * the ⠿ handle in its corner is only the visual cue from the artboard. Taps
 * still reach the pencil badge inside, because the pan only activates after
 * the long press. On release, `computeDropIndex` (a pure function,
 * unit-tested without gesture-handler) maps the tile's final position to a
 * grid index. Web gets move-up/move-down buttons in the pencil sheet instead.
 */
function DraggableTile({
  index,
  total,
  geometry,
  width,
  height,
  draggable,
  onDrop,
  children,
}: {
  index: number;
  total: number;
  geometry: GridGeometry;
  width: number;
  height: number;
  draggable: boolean;
  onDrop: (from: number, to: number) => void;
  children: React.ReactNode;
}) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const dragging = useSharedValue(0);

  const col = index % geometry.columns;
  const row = Math.floor(index / geometry.columns);
  const originX = col * geometry.cellWidth;
  const originY = row * geometry.cellHeight;

  const pan = Gesture.Pan()
    .enabled(draggable)
    .activateAfterLongPress(350)
    .onStart(() => {
      dragging.value = 1;
    })
    .onUpdate((event) => {
      translateX.value = event.translationX;
      translateY.value = event.translationY;
    })
    .onEnd((event) => {
      const dropIndex = computeDropIndex(originX + event.translationX, originY + event.translationY, geometry, total);
      translateX.value = withTiming(0);
      translateY.value = withTiming(0);
      dragging.value = 0;
      if (dropIndex !== index) {
        runOnJS(onDrop)(index, dropIndex);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: dragging.value ? 1.04 : 1 },
    ],
    zIndex: dragging.value ? 10 : 0,
    opacity: dragging.value ? 0.92 : 1,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        testID={`editor-photos-tile-${index}`}
        accessibilityLabel={index === 0 ? 'photo 1, on the grid' : `photo ${index + 1}`}
        style={[styles.tile, { width, height }, animatedStyle]}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  gestureRoot: { flex: 1 },
  safe: { flex: 1, backgroundColor: colors.paper },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.lgXl,
    paddingHorizontal: spacing.lgXl,
  },
  headerBtn: { minWidth: 44, minHeight: 44, alignItems: 'flex-start', justifyContent: 'center' },
  headerBtnRight: { minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  scroll: { paddingHorizontal: spacing.lgXl, paddingBottom: spacing.xxl },
  intro: { lineHeight: 19, marginBottom: spacing.lgXl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  tile: {
    borderRadius: radii.tile,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: colors.paperTint,
    ...shadows.sm,
  },
  tileImage: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  tileEmpty: {
    borderRadius: radii.tile,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.dashed,
    backgroundColor: colors.paperTint,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.smMd,
  },
  tileInert: {
    borderRadius: radii.tile,
    backgroundColor: colors.paperTint,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lgXl,
  },
  inertText: { textAlign: 'center' },
  topPills: {
    position: 'absolute',
    left: 8,
    top: 8,
    right: 48,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  onGridPill: {
    backgroundColor: colors.paperRaised,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.smMd,
    paddingVertical: spacing.xxs,
  },
  statePill: {
    backgroundColor: colors.paperRaised,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.smMd,
    paddingVertical: spacing.xxs,
  },
  pencilBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: radii.circle,
    backgroundColor: colors.paperRaised,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  plusBadgeFloat: {
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
  dragHandle: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 8, // brief: radius sm 8 (the theme's `radii.sm` is 16, an older token)
    backgroundColor: colors.paperRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: { marginTop: spacing.mdLg },
  rulesCard: {
    backgroundColor: colors.paperRaised,
    borderRadius: radii.card,
    padding: spacing.lgXl,
    gap: spacing.mdLg,
    marginTop: spacing.xl,
    ...shadows.sm,
  },
  ruleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.smMd },
  ruleText: { flex: 1, lineHeight: 19 },
});
