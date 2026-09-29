import { useCallback, useMemo, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { ActivityIndicator, FlatList, Image, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { me } from '../../../api/me';
import {
  addAlbumPhoto,
  deleteAlbum,
  getAlbum,
  listAlbumPhotos,
  removeAlbumPhoto,
  renameAlbum,
  signedAlbumPhotoUrls,
  type AlbumPhotoRow,
  type AlbumRow,
} from '../../../api/albums';
import { getAlbumOwnerFirstName } from '../../../api/albumOwner';
import { listSharesForSubject, listShareCandidates, revokeShare, shareAlbum, type ShareCandidate, type ShareRow } from '../../../api/shares';
import { isUnavailableError, mapSupabaseError } from '../../../api/errors';
import { leaveScreen, useGoneLatch, useLeaveWhenGone, useOnAppActive } from '../../../query/gone';
import { StoryViewer, type StoryPhoto } from '../../../albums/StoryViewer';
import { ConfirmButton } from '../../../settings/ConfirmButton';
import { colors, fontFamilies, radii, spacing } from '../../../theme/tokens';

const NAME_MAX_LENGTH = 60;

/**
 * `/settings/albums/[id]` — album detail (plan §5).
 *
 * Owner: this is the management view. Rename, add/remove photos, delete the
 * album, share and stop sharing, over a grid of thumbnails. Tapping a
 * thumbnail opens the story viewer (`albums/StoryViewer.tsx`) at that photo,
 * full screen over this one, with a `…` offering `remove this photo`
 * (the same `removeAlbumPhoto` the grid's own `remove` uses).
 *
 * Anyone else (reached from "shared with me" on the albums list): straight
 * into the story viewer, read-only, with the owner's first name under the
 * album's. Closing it goes back to the list.
 *
 * No dedicated mockup covers this screen (the 24 screens have a list view,
 * `Me-Albums.html`, but no detail view) — restyled onto the shared colour/
 * type tokens only, structure unchanged, rather than inventing a new
 * detail-screen layout.
 *
 * Reloads on focus, app foreground and reconnect. Gone (decision 90): an
 * album that was on screen and then reads back empty (a shared album whose
 * owner was suspended, banned or deleted their account, or whose share was
 * taken back; the owner's own album deleted elsewhere) sends the screen back
 * to the albums list without a word. The owner's "shared with" list and
 * candidates simply stop naming someone who vanished.
 */
export default function AlbumDetailScreen() {
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
  const [ownerName, setOwnerName] = useState<string | null>(null);
  /** The owner's story viewer: the photo it opened at, or `null` when closed. */
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const { gone, latch } = useGoneLatch();
  const hadAlbum = useRef(false);

  const isOwner = !!album && !!myUserId && album.owner_id === myUserId;

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

      const paths = photoRows.map((p) => p.storage_path);
      if (paths.length > 0) setPhotoUrls(await signedAlbumPhotoUrls(paths));

      const owner = !!albumRow && !!meResult && albumRow.owner_id === meResult.id;
      if (owner) {
        const [candidateRows, shareRows] = await Promise.all([
          listShareCandidates(),
          listSharesForSubject('album', albumId),
        ]);
        setCandidates(candidateRows);
        setShares(shareRows);
      } else if (albumRow) {
        setOwnerName(await getAlbumOwnerFirstName(albumRow.owner_id));
      }
      setLoadError(null);
    } catch (error) {
      setLoadError(mapSupabaseError(error).message);
    } finally {
      setLoaded(true);
    }
  }, [albumId, latch]);

  /** Signed URLs last 60 seconds: the viewer calls this when a photo fails to load. */
  const refreshUrls = useCallback(async () => {
    const paths = photos.map((p) => p.storage_path);
    if (paths.length === 0) return;
    const urls = await signedAlbumPhotoUrls(paths);
    setPhotoUrls((prev) => ({ ...prev, ...urls }));
  }, [photos]);

  const storyPhotos = useMemo<StoryPhoto[]>(
    () => photos.map((p) => ({ id: p.id, uri: photoUrls[p.storage_path] ?? null })),
    [photos, photoUrls]
  );

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
    onSuccess: (_void, next) => setAlbum((prev) => (prev ? { ...prev, name: next } : prev)),
    onError: (error: unknown) => setActionError(mapSupabaseError(error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteAlbum(albumId),
    onSuccess: () => router.replace('/settings/albums' as never),
    onError: (error: unknown) => setActionError(mapSupabaseError(error).message),
  });

  const addPhotoMutation = useMutation({
    mutationFn: (asset: { uri: string; width: number; height: number }) =>
      addAlbumPhoto({ albumId, uri: asset.uri, width: asset.width, height: asset.height }),
    onSuccess: (photo) => {
      setPhotos((prev) => [...prev, photo]);
      void signedAlbumPhotoUrls([photo.storage_path]).then((urls) =>
        setPhotoUrls((prev) => ({ ...prev, ...urls }))
      );
    },
    onError: (error: unknown) => setActionError(mapSupabaseError(error).message),
  });

  const removePhotoMutation = useMutation({
    mutationFn: (photo: { id: string; storage_path: string }) => removeAlbumPhoto(photo.id, photo.storage_path),
    onSuccess: (_void, photo) => setPhotos((prev) => prev.filter((p) => p.id !== photo.id)),
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

  async function pickAndAddPhoto() {
    setActionError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setActionError('allow photo library access to add a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled) return;
    const asset = result.assets[0];
    addPhotoMutation.mutate({ uri: asset.uri, width: asset.width, height: asset.height });
  }

  if (gone) {
    return <View style={styles.center} testID="album-gone" />;
  }

  if (!loaded) {
    return (
      <View style={styles.center} testID="album-loading">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!album) {
    return (
      <View style={styles.center} testID="album-unavailable">
        <Text style={styles.unavailable}>{loadError ?? 'this album isn’t available.'}</Text>
      </View>
    );
  }

  if (!isOwner) {
    return (
      <StoryViewer
        testID="album-viewer"
        photos={storyPhotos}
        title={album.name}
        ownerName={ownerName}
        onRetry={refreshUrls}
        onClose={() => leaveScreen('/settings/albums')}
      />
    );
  }

  const activeShares = shares.filter((s) => !s.revoked_at);
  const sharedUserIds = new Set(activeShares.map((s) => s.viewer_id));
  const shareableCandidates = candidates.filter((c) => !sharedUserIds.has(c.userId));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
    <FlatList
      testID="album-detail-screen"
      style={styles.container}
      data={photos}
      keyExtractor={(item) => item.id}
      numColumns={3}
      columnWrapperStyle={photos.length > 0 ? styles.photoRow : undefined}
      ListHeaderComponent={
        <View style={styles.header}>
          {isOwner ? (
            <View style={styles.renameRow}>
              <TextInput
                testID="album-name-input"
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
          ) : (
            <Text style={styles.title}>{album.name}</Text>
          )}

          {actionError ? (
            <Text style={styles.error} testID="album-action-error">
              {actionError}
            </Text>
          ) : null}

          {isOwner ? (
            <Pressable testID="album-add-photo" style={styles.secondaryButton} onPress={pickAndAddPhoto}>
              {addPhotoMutation.isPending ? (
                <ActivityIndicator color="#208AEF" />
              ) : (
                <Text style={styles.secondaryButtonText}>add photo</Text>
              )}
            </Pressable>
          ) : null}
        </View>
      }
      renderItem={({ item, index }) => {
        const url = photoUrls[item.storage_path];
        return (
          <View style={styles.photoCell} testID={`album-photo-${item.id}`}>
            <Pressable
              testID={`album-photo-open-${item.id}`}
              accessibilityRole="button"
              accessibilityLabel={`open photo ${index + 1} of ${photos.length}`}
              style={styles.photoOpen}
              onPress={() => {
                setActionError(null);
                setViewerIndex(index);
              }}
            >
              {url ? <Image source={{ uri: url }} style={styles.photoImage} /> : <View style={styles.photoPlaceholder} />}
            </Pressable>
            {isOwner ? (
              <Pressable
                testID={`album-photo-remove-${item.id}`}
                style={styles.removeButton}
                onPress={() => removePhotoMutation.mutate(item)}
              >
                <Text style={styles.removeButtonText}>remove</Text>
              </Pressable>
            ) : null}
          </View>
        );
      }}
      ListFooterComponent={
        isOwner ? (
          <View style={styles.footer}>
            <Text style={styles.sectionTitle}>shared with</Text>
            {activeShares.length === 0 ? <Text style={styles.empty}>not shared with anyone yet.</Text> : null}
            {activeShares.map((share) => (
              <View key={share.id} style={styles.shareRow} testID={`album-share-${share.viewer_id}`}>
                <Text style={styles.shareText}>
                  {candidates.find((c) => c.userId === share.viewer_id)?.firstName ?? share.viewer_id}
                </Text>
                <Pressable testID={`album-revoke-${share.viewer_id}`} onPress={() => revokeMutation.mutate(share.id)}>
                  <Text style={styles.revokeText}>stop sharing</Text>
                </Pressable>
              </View>
            ))}

            <Text style={styles.sectionTitle}>share with</Text>
            {shareableCandidates.length === 0 ? (
              <Text style={styles.empty}>only people you have an open conversation with can be offered here.</Text>
            ) : null}
            {shareableCandidates.map((candidate) => (
              <Pressable
                key={candidate.userId}
                testID={`album-share-candidate-${candidate.userId}`}
                style={styles.shareRow}
                onPress={() => shareMutation.mutate(candidate.userId)}
              >
                <Text style={styles.shareText}>{candidate.firstName ?? candidate.userId}</Text>
                <Text style={styles.shareAction}>share</Text>
              </Pressable>
            ))}

            <ConfirmButton
              testID="album-delete"
              label="delete album"
              busy={deleteMutation.isPending}
              onPress={() => deleteMutation.mutate()}
            />
          </View>
        ) : null
      }
      ListEmptyComponent={<Text style={styles.empty}>no photos yet.</Text>}
    />

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
          onRetry={refreshUrls}
          onClose={() => setViewerIndex(null)}
          notice={actionError}
          actions={[
            {
              key: 'remove',
              label: 'remove this photo',
              destructive: true,
              onPress: (photo) => {
                const row = photos.find((p) => p.id === photo.id);
                if (!row) return;
                setActionError(null);
                removePhotoMutation.mutate(row);
              },
            },
          ]}
        />
      ) : null}
    </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  container: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.paper },
  unavailable: { color: colors.muted, fontSize: 15, textAlign: 'center', fontFamily: fontFamilies.outfit },
  header: { padding: spacing.lgXl, gap: spacing.md },
  title: { fontSize: 20, fontFamily: fontFamilies.outfitBold, color: colors.ink },
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
  error: { color: colors.danger, fontSize: 13, fontFamily: fontFamilies.outfit },
  secondaryButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.smMd,
  },
  secondaryButtonText: { color: colors.signal, fontFamily: fontFamilies.outfitSemiBold },
  photoRow: { gap: spacing.xs, paddingHorizontal: spacing.lgXl },
  photoCell: { flex: 1 / 3, aspectRatio: 1, margin: 2, position: 'relative' },
  photoOpen: { width: '100%', height: '100%' },
  photoImage: { width: '100%', height: '100%', borderRadius: radii.sm / 2 },
  photoPlaceholder: { width: '100%', height: '100%', borderRadius: radii.sm / 2, backgroundColor: colors.tint },
  removeButton: { position: 'absolute', top: 2, right: 2, backgroundColor: colors.overlay, borderRadius: 4, paddingHorizontal: 4 },
  removeButtonText: { color: colors.onDark, fontSize: 10 },
  footer: { padding: spacing.lgXl, gap: spacing.md },
  sectionTitle: { fontSize: 15, fontFamily: fontFamilies.outfitSemiBold, color: colors.ink, marginTop: spacing.md },
  empty: { color: colors.subtle, fontSize: 13, fontFamily: fontFamilies.outfit },
  shareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.smMd,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  shareText: { fontSize: 14, color: colors.ink, fontFamily: fontFamilies.outfit },
  shareAction: { fontSize: 14, color: colors.signal, fontFamily: fontFamilies.outfitSemiBold },
  revokeText: { fontSize: 14, color: colors.danger, fontFamily: fontFamilies.outfit },
});
