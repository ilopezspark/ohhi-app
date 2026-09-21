import { useCallback, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
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
import { listSharesForSubject, listShareCandidates, revokeShare, shareAlbum, type ShareCandidate, type ShareRow } from '../../../api/shares';
import { mapSupabaseError } from '../../../api/errors';
import { ConfirmButton } from '../../../settings/ConfirmButton';
import { colors, fontFamilies, radii, spacing } from '../../../theme/tokens';

const NAME_MAX_LENGTH = 60;

/**
 * `/settings/albums/[id]` — album detail (plan §5). Owner view: rename,
 * add/remove photos, delete album, share/revoke. Viewer view (reached from
 * "shared with me"): read-only photos, no owner controls.
 *
 * No dedicated mockup covers this screen (the 24 screens have a list view,
 * `Me-Albums.html`, but no detail view) — restyled onto the shared colour/
 * type tokens only, structure unchanged, rather than inventing a new
 * detail-screen layout.
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

  const isOwner = !!album && !!myUserId && album.owner_id === myUserId;

  const load = useCallback(async () => {
    if (!albumId) return;
    try {
      const [meResult, albumRow, photoRows] = await Promise.all([me(), getAlbum(albumId), listAlbumPhotos(albumId)]);
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
      }
      setLoadError(null);
    } catch (error) {
      setLoadError(mapSupabaseError(error).message);
    } finally {
      setLoaded(true);
    }
  }, [albumId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
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
    mutationFn: (photoId: string) => removeAlbumPhoto(photoId),
    onSuccess: (_void, photoId) => setPhotos((prev) => prev.filter((p) => p.id !== photoId)),
    onError: (error: unknown) => setActionError(mapSupabaseError(error).message),
  });

  const shareMutation = useMutation({
    mutationFn: (viewerId: string) => shareAlbum(albumId, viewerId),
    onSuccess: (share) => setShares((prev) => [share, ...prev]),
    onError: (error: unknown) => setActionError(mapSupabaseError(error).message),
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
      setActionError('Allow photo library access to add a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled) return;
    const asset = result.assets[0];
    addPhotoMutation.mutate({ uri: asset.uri, width: asset.width, height: asset.height });
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
        <Text style={styles.unavailable}>{loadError ?? 'This album isn’t available.'}</Text>
      </View>
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
                <Text style={styles.secondaryButtonText}>Add photo</Text>
              )}
            </Pressable>
          ) : null}
        </View>
      }
      renderItem={({ item }) => {
        const url = photoUrls[item.storage_path];
        return (
          <View style={styles.photoCell} testID={`album-photo-${item.id}`}>
            {url ? <Image source={{ uri: url }} style={styles.photoImage} /> : <View style={styles.photoPlaceholder} />}
            {item.moderation_state === 'pending' ? (
              <Text style={styles.pendingBadge} testID={`album-photo-pending-${item.id}`}>
                Pending review
              </Text>
            ) : null}
            {isOwner ? (
              <Pressable
                testID={`album-photo-remove-${item.id}`}
                style={styles.removeButton}
                onPress={() => removePhotoMutation.mutate(item.id)}
              >
                <Text style={styles.removeButtonText}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
        );
      }}
      ListFooterComponent={
        isOwner ? (
          <View style={styles.footer}>
            <Text style={styles.sectionTitle}>Shared with</Text>
            {activeShares.length === 0 ? <Text style={styles.empty}>Not shared with anyone yet.</Text> : null}
            {activeShares.map((share) => (
              <View key={share.id} style={styles.shareRow} testID={`album-share-${share.viewer_id}`}>
                <Text style={styles.shareText}>
                  {candidates.find((c) => c.userId === share.viewer_id)?.firstName ?? share.viewer_id}
                </Text>
                <Pressable testID={`album-revoke-${share.viewer_id}`} onPress={() => revokeMutation.mutate(share.id)}>
                  <Text style={styles.revokeText}>Revoke</Text>
                </Pressable>
              </View>
            ))}

            <Text style={styles.sectionTitle}>Share with</Text>
            {shareableCandidates.length === 0 ? (
              <Text style={styles.empty}>Only people you have an open conversation with can be offered here.</Text>
            ) : null}
            {shareableCandidates.map((candidate) => (
              <Pressable
                key={candidate.userId}
                testID={`album-share-candidate-${candidate.userId}`}
                style={styles.shareRow}
                onPress={() => shareMutation.mutate(candidate.userId)}
              >
                <Text style={styles.shareText}>{candidate.firstName ?? candidate.userId}</Text>
                <Text style={styles.shareAction}>Share</Text>
              </Pressable>
            ))}

            <ConfirmButton
              testID="album-delete"
              label="Delete album"
              busy={deleteMutation.isPending}
              onPress={() => deleteMutation.mutate()}
            />
          </View>
        ) : null
      }
      ListEmptyComponent={<Text style={styles.empty}>No photos yet.</Text>}
    />
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
  photoImage: { width: '100%', height: '100%', borderRadius: radii.sm / 2 },
  photoPlaceholder: { width: '100%', height: '100%', borderRadius: radii.sm / 2, backgroundColor: colors.tint },
  pendingBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    right: 4,
    fontSize: 9,
    color: colors.onDark,
    backgroundColor: colors.overlay,
    textAlign: 'center',
    borderRadius: 4,
    paddingVertical: 1,
    fontFamily: fontFamilies.outfitSemiBold,
  },
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
