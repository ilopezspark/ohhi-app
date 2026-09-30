import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { ActivityIndicator, FlatList, Image, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { me } from '../../../../api/me';
import {
  addAlbumPhoto,
  addAlbumVideo,
  deleteAlbum,
  getAlbum,
  listAlbumPhotos,
  removeAlbumPhoto,
  renameAlbum,
  signedAlbumPhotoUrls,
  type AlbumPhotoRow,
  type AlbumRow,
} from '../../../../api/albums';
import {
  albumHasVideo,
  albumSignPaths,
  albumStoryItems,
  formatVideoDuration,
  isAlbumVideo,
} from '../../../../albums/albumMedia';
import { batchNoticeLines, planAlbumBatch, runAlbumBatch, type PickedMedia } from '../../../../albums/addBatch';
import { CHAT_MEDIA_PICK_OPTIONS } from '../../../../chat/videoPrep';
import { PlayIcon } from '../../../../chat/mediaIcons';
import { listSharesForSubject, listShareCandidates, revokeShare, shareAlbum, type ShareCandidate, type ShareRow } from '../../../../api/shares';
import { isUnavailableError, mapSupabaseError } from '../../../../api/errors';
import { leaveScreen, useGoneLatch, useLeaveWhenGone, useOnAppActive } from '../../../../query/gone';
import { StoryViewer, type StoryPhoto } from '../../../../albums/StoryViewer';
import { useAlbumOwner } from '../../../../albums/useAlbumOwner';
import {
  ADD_PHOTOS_LABEL,
  addingProgressLine,
  ALBUM_HOLDS_NOTE,
  VIDEO_SLOT_TAKEN_NOTE,
  REMOVE_PHOTO_CONFIRM,
  REMOVE_PHOTO_LABEL,
  REMOVE_VIDEO_CONFIRM,
  REMOVE_VIDEO_LABEL,
} from '../../../../albums/albumCopy';
import { ConfirmButton } from '../../../../settings/ConfirmButton';
import { ScreenHeader, Sheet, Text } from '../../../../ui';
import { KeyboardSpacer } from '../../../../ui/KeyboardSpacer';
import { displayName } from '../../../../ui/displayName';
import { colors, fontFamilies, radii, spacing } from '../../../../theme/tokens';

const NAME_MAX_LENGTH = 60;

/**
 * `/settings/albums/[id]/edit`: the album's management grid, the one place
 * an album is shown as a gallery (the owner's ruling, 2026-09-29: "the only
 * ui where it should open as a gallery is when editing it, that can be done
 * in the albums page not within chat"). Reached only from the albums page:
 * the `edit` on an album tile (`settings/albums/index.tsx`) and `edit album`
 * in the owner's story `…` (`settings/albums/[id].tsx`). Nothing in chat
 * links here.
 *
 * Rename, add photos, remove a photo (asks first, since it is permanent),
 * share and stop sharing, delete the album. Tapping a thumbnail opens that
 * photo in the story, over this screen, with `remove this photo` in its `…`
 * (asking first too).
 *
 * Adding (the owner's ruling, 2026-09-30: "when adding photos they can add
 * multiple at a time, note that albums are for pictures and one video
 * only"): `add photos` opens the library with several picks allowed, videos
 * included only while the album has no video. The picks upload one at a
 * time (`albums/addBatch.ts`) with an `adding 2 of 5` line; a pick that
 * fails is named afterwards and the rest still go in; extra videos are
 * refused before anything uploads. The video shows in the grid as its
 * poster with a play badge and its length, and removing it takes the row,
 * then the video and its poster.
 *
 * Owner only. Anyone else who lands here (a stale link) is sent to the
 * album's story instead, which is what they can see.
 *
 * Reloads on focus, app foreground and reconnect. Gone (decision 90): an
 * album that was on screen and then reads back empty (deleted elsewhere)
 * sends the screen back to the albums list without a word. The "shared
 * with" list and candidates simply stop naming someone who vanished.
 */
export default function AlbumEditScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const albumId = Array.isArray(params.id) ? params.id[0] : params.id ?? '';

  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [album, setAlbum] = useState<AlbumRow | null>(null);
  const [photos, setPhotos] = useState<AlbumPhotoRow[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [candidates, setCandidates] = useState<ShareCandidate[]>([]);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [name, setName] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** The photo waiting on "remove this photo?" from the grid, or `null`. */
  const [confirmRemove, setConfirmRemove] = useState<AlbumPhotoRow | null>(null);
  /** The story over this screen: the photo it opened at, or `null` when closed. */
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  /** While a batch of picks uploads: which one of how many. */
  const [adding, setAdding] = useState<{ current: number; total: number } | null>(null);
  /** After a batch: what didn't go in, and why. */
  const [addNotice, setAddNotice] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const { gone, latch } = useGoneLatch();
  const hadAlbum = useRef(false);

  const isOwner = !!album && !!myUserId && album.owner_id === myUserId;
  const myCard = useAlbumOwner(isOwner ? myUserId : null);

  const load = useCallback(async () => {
    if (!albumId) return;
    try {
      const [meResult, albumRow, photoRows] = await Promise.all([me(), getAlbum(albumId), listAlbumPhotos(albumId)]);
      if (!albumRow && hadAlbum.current) {
        latch(true);
        return;
      }
      if (albumRow) hadAlbum.current = true;
      setMyUserId(meResult?.id ?? null);
      setAlbum(albumRow);
      setName(albumRow?.name ?? '');
      setPhotos(photoRows);

      const owner = !!albumRow && !!meResult && albumRow.owner_id === meResult.id;
      if (!owner) {
        setLoadError(null);
        return;
      }

      const paths = albumSignPaths(photoRows);
      if (paths.length > 0) setPhotoUrls(await signedAlbumPhotoUrls(paths));
      const [candidateRows, shareRows] = await Promise.all([listShareCandidates(), listSharesForSubject('album', albumId)]);
      setCandidates(candidateRows);
      setShares(shareRows);
      setLoadError(null);
    } catch (error) {
      setLoadError(mapSupabaseError(error).message);
    } finally {
      setLoaded(true);
    }
  }, [albumId, latch]);

  // Not the owner: this is not their screen. Their view of it is the story.
  const notMine = loaded && !!album && !!myUserId && album.owner_id !== myUserId;
  useEffect(() => {
    if (notMine) router.replace(`/settings/albums/${albumId}` as never);
  }, [notMine, albumId]);

  /** Everything else that shows this album reads it again after a change here. */
  const refreshElsewhere = useCallback(() => {
    for (const key of [['album-story', albumId], ['album-story-photos', albumId], ['my_albums'], ['me', 'albums'], ['me', 'albums_summary']]) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  }, [albumId, queryClient]);

  /** Signed URLs last 60 seconds: the story calls this when a photo fails to load. */
  const refreshUrls = useCallback(async () => {
    const paths = albumSignPaths(photos);
    if (paths.length === 0) return;
    const urls = await signedAlbumPhotoUrls(paths);
    setPhotoUrls((prev) => ({ ...prev, ...urls }));
  }, [photos]);

  const storyPhotos = useMemo<StoryPhoto[]>(() => albumStoryItems(photos, photoUrls), [photos, photoUrls]);
  const hasVideo = albumHasVideo(photos);

  useFocusEffect(
    useCallback(() => {
      if (!gone) void load();
    }, [load, gone])
  );
  useOnAppActive(() => {
    if (!gone) void load();
  });
  useLeaveWhenGone(
    gone,
    () => {
      for (const key of [['shared_with_me_albums'], ['my_albums'], ['me', 'albums'], ['me', 'albums_summary']]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
    '/settings/albums'
  );

  const renameMutation = useMutation({
    mutationFn: (next: string) => renameAlbum(albumId, next),
    onSuccess: (_void, next) => {
      setAlbum((prev) => (prev ? { ...prev, name: next } : prev));
      refreshElsewhere();
    },
    onError: (error: unknown) => setActionError(mapSupabaseError(error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteAlbum(albumId),
    onSuccess: () => {
      refreshElsewhere();
      // Back past this album's story too: it no longer exists.
      const nav = router as unknown as { dismissTo?: (href: string) => void };
      if (typeof nav.dismissTo === 'function') nav.dismissTo('/settings/albums');
      else router.replace('/settings/albums' as never);
    },
    onError: (error: unknown) => setActionError(mapSupabaseError(error).message),
  });

  const removePhotoMutation = useMutation({
    // The row, then its objects: a video takes its poster with it.
    mutationFn: (photo: AlbumPhotoRow) =>
      isAlbumVideo(photo)
        ? removeAlbumPhoto(photo.id, photo.storage_path, photo.media_poster_path)
        : removeAlbumPhoto(photo.id, photo.storage_path),
    onSuccess: (_void, photo) => {
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
      refreshElsewhere();
    },
    onError: (error: unknown) => setActionError(mapSupabaseError(error).message),
  });

  const shareMutation = useMutation({
    mutationFn: (viewerId: string) => shareAlbum(albumId, viewerId),
    onSuccess: (share) => setShares((prev) => [share, ...prev]),
    onError: (error: unknown) => {
      setActionError(mapSupabaseError(error).message);
      // Refused like any other when the person has vanished (decision 90):
      // reload so they drop out of the candidates instead of inviting retries.
      if (isUnavailableError(error)) void load();
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (shareId: string) => revokeShare(shareId),
    onSuccess: (_void, shareId) =>
      setShares((prev) => prev.map((s) => (s.id === shareId ? { ...s, revoked_at: new Date().toISOString() } : s))),
    onError: (error: unknown) => setActionError(mapSupabaseError(error).message),
  });

  /**
   * Several picks at once, uploaded one after another. Videos are offered
   * only while the album has none; the picker can't limit how many videos
   * are picked, so any beyond the one are refused before anything uploads
   * (`planAlbumBatch`). A failed pick is named afterwards; the rest go in.
   */
  async function pickAndAdd() {
    if (adding) return;
    setActionError(null);
    setAddNotice([]);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setActionError('allow photo library access to add photos.');
      return;
    }
    const videoTaken = albumHasVideo(photos);
    const result = await ImagePicker.launchImageLibraryAsync({
      // Chat's video settings (the 30 s cap, iOS's H.264 export) for the one video.
      ...CHAT_MEDIA_PICK_OPTIONS,
      mediaTypes: videoTaken ? ['images'] : ['images', 'videos'],
      allowsMultipleSelection: true,
      orderedSelection: true,
    });
    if (result.canceled || !result.assets || result.assets.length === 0) return;

    const plan = planAlbumBatch(result.assets, videoTaken);
    if (plan.items.length === 0) {
      setAddNotice(batchNoticeLines(plan, null));
      return;
    }

    setAdding({ current: 1, total: plan.items.length });
    let outcome: Awaited<ReturnType<typeof runAlbumBatch<AlbumPhotoRow>>> | null = null;
    try {
      outcome = await runAlbumBatch<AlbumPhotoRow>(plan.items, {
        addPhoto: (asset: PickedMedia) =>
          addAlbumPhoto({ albumId, uri: asset.uri, width: asset.width, height: asset.height }),
        addVideo: (asset: PickedMedia) =>
          addAlbumVideo({
            albumId,
            uri: asset.uri,
            width: asset.width,
            height: asset.height,
            durationMs: asset.duration,
            bytes: asset.fileSize,
          }),
        onProgress: (current, total) => setAdding({ current, total }),
        onAdded: (row) => setPhotos((prev) => (prev.some((p) => p.id === row.id) ? prev : [...prev, row])),
      });
    } finally {
      setAdding(null);
    }
    setAddNotice(batchNoticeLines(plan, outcome));
    refreshElsewhere();
    await load();
  }

  const back = useCallback(() => leaveScreen('/settings/albums'), []);

  if (gone) {
    return <View style={styles.center} testID="album-gone" />;
  }

  if (!loaded || notMine) {
    return (
      <View style={styles.center} testID="album-loading">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!album) {
    // A way back, even here: this screen is pushed, and a dead end with no
    // back arrow only has the hardware back.
    return (
      <View style={styles.safe}>
        <ScreenHeader onBack={back} backTestID="album-unavailable-back" />
        <View style={styles.center} testID="album-unavailable">
          <Text variant="body" color={colors.muted} style={styles.unavailable}>
            {loadError ?? 'this album isn’t available.'}
          </Text>
        </View>
      </View>
    );
  }

  const removeConfirm = confirmRemove && isAlbumVideo(confirmRemove) ? REMOVE_VIDEO_CONFIRM : REMOVE_PHOTO_CONFIRM;
  const removeFromStory = (photo: StoryPhoto | null) => {
    const row = photos.find((p) => p.id === photo?.id);
    if (!row) return;
    setActionError(null);
    removePhotoMutation.mutate(row);
  };

  const activeShares = shares.filter((s) => !s.revoked_at);
  const sharedUserIds = new Set(activeShares.map((s) => s.viewer_id));
  const shareableCandidates = candidates.filter((c) => !sharedUserIds.has(c.userId));

  return (
    <View style={styles.safe}>
      <ScreenHeader title="edit album" titleSize={24} onBack={back} testID="album-edit-header" />
      <FlatList
        testID="album-detail-screen"
        style={styles.container}
        data={photos}
        keyExtractor={(item) => item.id}
        numColumns={3}
        columnWrapperStyle={photos.length > 0 ? styles.photoRow : undefined}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.renameRow}>
              <TextInput
                testID="album-name-input"
                accessibilityLabel="album name"
                style={styles.nameInput}
                value={name}
                maxLength={NAME_MAX_LENGTH}
                onChangeText={setName}
                onBlur={() => {
                  const trimmed = name.trim();
                  if (trimmed && trimmed !== album.name) renameMutation.mutate(trimmed);
                }}
              />
            </View>

            {actionError ? (
              <Text variant="helper" color={colors.danger} testID="album-action-error">
                {actionError}
              </Text>
            ) : null}

            <Pressable
              testID="album-add-photo"
              accessibilityRole="button"
              accessibilityLabel={adding ? addingProgressLine(adding.current, adding.total) : ADD_PHOTOS_LABEL}
              accessibilityState={{ busy: !!adding, disabled: !!adding }}
              disabled={!!adding}
              style={styles.secondaryButton}
              onPress={pickAndAdd}
            >
              {adding ? (
                <View style={styles.progressRow}>
                  <ActivityIndicator color={colors.signal} size="small" />
                  <Text variant="rowLabel" color={colors.signal} testID="album-add-progress">
                    {addingProgressLine(adding.current, adding.total)}
                  </Text>
                </View>
              ) : (
                <Text variant="rowLabel" color={colors.signal}>
                  {ADD_PHOTOS_LABEL}
                </Text>
              )}
            </Pressable>
            <Text variant="helper" testID="album-holds-note">
              {hasVideo ? VIDEO_SLOT_TAKEN_NOTE : ALBUM_HOLDS_NOTE}
            </Text>
            {addNotice.length > 0 ? (
              <View testID="album-add-notice" style={styles.noticeLines}>
                {addNotice.map((line) => (
                  <Text key={line} variant="helper" color={colors.danger}>
                    {line}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item, index }) => {
          const video = isAlbumVideo(item);
          // The video shows as its poster; the grid never plays it.
          const url = video ? (item.media_poster_path ? photoUrls[item.media_poster_path] : undefined) : photoUrls[item.storage_path];
          const noun = video ? 'video' : 'photo';
          return (
            <View style={styles.photoCell} testID={`album-photo-${item.id}`}>
              <Pressable
                testID={`album-photo-open-${item.id}`}
                accessibilityRole="button"
                accessibilityLabel={`open ${noun} ${index + 1} of ${photos.length}`}
                style={styles.photoOpen}
                onPress={() => {
                  setActionError(null);
                  setViewerIndex(index);
                }}
              >
                {url ? (
                  <Image source={{ uri: url }} style={styles.photoImage} testID={`album-photo-image-${item.id}`} />
                ) : (
                  <View style={styles.photoPlaceholder} />
                )}
                {video ? (
                  <View style={styles.videoBadge} pointerEvents="none" testID={`album-video-badge-${item.id}`}>
                    <PlayIcon size={12} color={colors.onDark} />
                    <Text variant="micro" color={colors.onDark} testID={`album-video-duration-${item.id}`}>
                      {formatVideoDuration(item.media_duration_ms)}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
              <Pressable
                testID={`album-photo-remove-${item.id}`}
                accessibilityRole="button"
                accessibilityLabel={`remove ${noun} ${index + 1}`}
                style={styles.removeButton}
                hitSlop={6}
                onPress={() => setConfirmRemove(item)}
              >
                <Text variant="micro" color={colors.onDark}>
                  remove
                </Text>
              </Pressable>
            </View>
          );
        }}
        ListFooterComponent={
          <View style={styles.footer}>
            <Text variant="rowLabel" style={styles.sectionTitle}>
              shared with
            </Text>
            {activeShares.length === 0 ? <Text variant="helper">not shared with anyone yet.</Text> : null}
            {activeShares.map((share) => (
              <View key={share.id} style={styles.shareRow} testID={`album-share-${share.viewer_id}`}>
                <Text variant="body">{displayName(candidates.find((c) => c.userId === share.viewer_id)?.firstName) || share.viewer_id}</Text>
                <Pressable testID={`album-revoke-${share.viewer_id}`} accessibilityRole="button" onPress={() => revokeMutation.mutate(share.id)}>
                  <Text variant="body" color={colors.danger}>
                    stop sharing
                  </Text>
                </Pressable>
              </View>
            ))}

            <Text variant="rowLabel" style={styles.sectionTitle}>
              share with
            </Text>
            {shareableCandidates.length === 0 ? (
              <Text variant="helper">only people you have an open conversation with can be offered here.</Text>
            ) : null}
            {shareableCandidates.map((candidate) => (
              <Pressable
                key={candidate.userId}
                testID={`album-share-candidate-${candidate.userId}`}
                accessibilityRole="button"
                style={styles.shareRow}
                onPress={() => shareMutation.mutate(candidate.userId)}
              >
                <Text variant="body">{displayName(candidate.firstName) || candidate.userId}</Text>
                <Text variant="rowLabel" color={colors.signal}>
                  share
                </Text>
              </Pressable>
            ))}

            <ConfirmButton
              testID="album-delete"
              label="delete album"
              busy={deleteMutation.isPending}
              onPress={() => deleteMutation.mutate()}
            />
          </View>
        }
        ListEmptyComponent={
          <Text variant="helper" style={styles.emptyGrid}>
            no photos yet.
          </Text>
        }
      />
      {/* While the name field has the keyboard, the list ends on the keyboard
          instead of under it, so the rest of the page can still be scrolled to. */}
      <KeyboardSpacer bottomInset={0} testID="album-edit-keyboard" />

      {confirmRemove ? (
        <Sheet testID="album-remove-confirm" onDismiss={() => setConfirmRemove(null)}>
          <Text variant="title" style={styles.confirmTitle}>
            {removeConfirm.title}
          </Text>
          {removeConfirm.body ? <Text variant="helper">{removeConfirm.body}</Text> : null}
          <Pressable
            testID="album-remove-confirm-yes"
            accessibilityRole="button"
            style={styles.sheetRow}
            onPress={() => {
              const row = confirmRemove;
              setConfirmRemove(null);
              setActionError(null);
              removePhotoMutation.mutate(row);
            }}
          >
            <Text variant="rowLabel" color={colors.danger}>
              {removeConfirm.confirmLabel}
            </Text>
          </Pressable>
          <Pressable
            testID="album-remove-confirm-no"
            accessibilityRole="button"
            style={styles.sheetRow}
            onPress={() => setConfirmRemove(null)}
          >
            <Text variant="rowLabel">{removeConfirm.cancelLabel}</Text>
          </Pressable>
        </Sheet>
      ) : null}

      <Modal
        visible={viewerIndex !== null}
        animationType="fade"
        presentationStyle="overFullScreen"
        transparent={false}
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setViewerIndex(null)}
      >
        {viewerIndex !== null ? (
          <StoryViewer
            testID="album-owner-viewer"
            photos={storyPhotos}
            initialIndex={viewerIndex}
            title={album.name}
            owner={myCard}
            onRetry={refreshUrls}
            onClose={() => setViewerIndex(null)}
            notice={actionError}
            actions={[
              {
                key: 'remove',
                label: REMOVE_PHOTO_LABEL,
                destructive: true,
                needsPhoto: true,
                kinds: ['photo'],
                confirm: REMOVE_PHOTO_CONFIRM,
                onPress: removeFromStory,
              },
              {
                key: 'remove-video',
                label: REMOVE_VIDEO_LABEL,
                destructive: true,
                needsPhoto: true,
                kinds: ['video'],
                confirm: REMOVE_VIDEO_CONFIRM,
                onPress: removeFromStory,
              },
            ]}
          />
        ) : null}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  container: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.paper },
  unavailable: { textAlign: 'center' },
  header: { paddingHorizontal: spacing.lgXl, paddingTop: spacing.md, paddingBottom: spacing.lgXl, gap: spacing.md },
  renameRow: { flexDirection: 'row' },
  nameInput: {
    flex: 1,
    fontSize: 20,
    fontFamily: fontFamilies.outfitBold,
    color: colors.ink,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingVertical: spacing.xs,
  },
  secondaryButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.smMd,
    minHeight: 40,
    justifyContent: 'center',
  },
  photoRow: { gap: spacing.xs, paddingHorizontal: spacing.lgXl },
  photoCell: { flex: 1 / 3, aspectRatio: 1, margin: 2, position: 'relative' },
  photoOpen: { width: '100%', height: '100%' },
  photoImage: { width: '100%', height: '100%', borderRadius: radii.sm / 2 },
  photoPlaceholder: { width: '100%', height: '100%', borderRadius: radii.sm / 2, backgroundColor: colors.tint },
  videoBadge: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.overlay,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.smMd,
    paddingVertical: 2,
  },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.smMd },
  noticeLines: { gap: spacing.xs },
  removeButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: colors.overlay,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.smMd,
    paddingVertical: 2,
  },
  footer: { padding: spacing.lgXl, gap: spacing.md },
  sectionTitle: { marginTop: spacing.md },
  emptyGrid: { paddingHorizontal: spacing.lgXl },
  shareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.smMd,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  sheetRow: { paddingVertical: spacing.lg, minHeight: 44, justifyContent: 'center' },
  confirmTitle: { fontSize: 17 },
});
