import { useCallback, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
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

const NAME_MAX_LENGTH = 60;

/**
 * `/settings/albums/[id]` — album detail (plan §5). Owner view: rename,
 * add/remove photos, delete album, share/revoke. Viewer view (reached from
 * "shared with me"): read-only photos, no owner controls.
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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  unavailable: { color: '#555', fontSize: 15, textAlign: 'center' },
  header: { padding: 16, gap: 10 },
  title: { fontSize: 20, fontWeight: '700' },
  renameRow: { flexDirection: 'row' },
  nameInput: { flex: 1, fontSize: 20, fontWeight: '700', borderBottomWidth: 1, borderBottomColor: '#ccc', paddingVertical: 4 },
  error: { color: '#B00020', fontSize: 13 },
  secondaryButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#208AEF',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  secondaryButtonText: { color: '#208AEF', fontWeight: '600' },
  photoRow: { gap: 4, paddingHorizontal: 16 },
  photoCell: { flex: 1 / 3, aspectRatio: 1, margin: 2, position: 'relative' },
  photoImage: { width: '100%', height: '100%', borderRadius: 6 },
  photoPlaceholder: { width: '100%', height: '100%', borderRadius: 6, backgroundColor: '#eee' },
  pendingBadge: { position: 'absolute', bottom: 4, left: 4, right: 4, fontSize: 9, color: '#fff', backgroundColor: 'rgba(0,0,0,0.6)', textAlign: 'center', borderRadius: 4, paddingVertical: 1 },
  removeButton: { position: 'absolute', top: 2, right: 2, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 4, paddingHorizontal: 4 },
  removeButtonText: { color: '#fff', fontSize: 10 },
  footer: { padding: 16, gap: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '600', marginTop: 10 },
  empty: { color: '#777', fontSize: 13 },
  shareRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e2e2e2' },
  shareText: { fontSize: 14, color: '#222' },
  shareAction: { fontSize: 14, color: '#208AEF', fontWeight: '600' },
  revokeText: { fontSize: 14, color: '#B00020' },
});
