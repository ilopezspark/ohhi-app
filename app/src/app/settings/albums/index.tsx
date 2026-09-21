import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { createAlbum, listMyAlbums, listSharedWithMeAlbums, type AlbumRow, type SharedAlbum } from '../../../api/albums';
import { mapSupabaseError } from '../../../api/errors';

const NAME_MAX_LENGTH = 60;

/** `/settings/albums` — the album list (plan §5): mine, plus "shared with me". */
export default function AlbumsListScreen() {
  const [albums, setAlbums] = useState<AlbumRow[]>([]);
  const [shared, setShared] = useState<SharedAlbum[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    try {
      const [mine, sharedWithMe] = await Promise.all([listMyAlbums(), listSharedWithMeAlbums()]);
      setAlbums(mine);
      setShared(sharedWithMe);
      setLoadError(null);
    } catch (error) {
      setLoadError(mapSupabaseError(error).message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const createMutation = useMutation({
    mutationFn: (name: string) => createAlbum(name),
    onSuccess: (album) => {
      setNewName('');
      setAlbums((prev) => [album, ...prev]);
    },
  });

  const trimmedName = newName.trim();
  const canCreate = trimmedName.length > 0 && trimmedName.length <= NAME_MAX_LENGTH && !createMutation.isPending;

  if (!loaded) {
    return (
      <View style={styles.center} testID="albums-loading">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container} testID="albums-screen">
      <Text style={styles.title}>Albums</Text>

      <View style={styles.createRow}>
        <TextInput
          testID="albums-new-name"
          style={styles.input}
          placeholder="New album name"
          maxLength={NAME_MAX_LENGTH}
          value={newName}
          onChangeText={setNewName}
        />
        <Pressable
          testID="albums-create"
          style={[styles.createButton, !canCreate && styles.buttonDisabled]}
          disabled={!canCreate}
          accessibilityState={{ disabled: !canCreate }}
          onPress={() => createMutation.mutate(trimmedName)}
        >
          {createMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.createButtonText}>Add</Text>}
        </Pressable>
      </View>
      {createMutation.isError ? (
        <Text style={styles.error} testID="albums-create-error">
          {mapSupabaseError(createMutation.error).message}
        </Text>
      ) : null}
      {loadError ? (
        <Text style={styles.error} testID="albums-load-error">
          {loadError}
        </Text>
      ) : null}

      <FlatList
        testID="albums-my-list"
        data={albums}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text style={styles.empty}>No albums yet.</Text>}
        renderItem={({ item }) => (
          <Pressable
            testID={`albums-item-${item.id}`}
            style={styles.row}
            onPress={() => router.push(`/settings/albums/${item.id}` as never)}
          >
            <Text style={styles.rowTitle}>{item.name}</Text>
            <Text style={styles.rowMeta}>{`${item.photo_count} photo${item.photo_count === 1 ? '' : 's'}`}</Text>
          </Pressable>
        )}
      />

      <Text style={styles.sectionTitle}>Shared with me</Text>
      <FlatList
        testID="albums-shared-list"
        data={shared}
        keyExtractor={(item) => item.share_id}
        ListEmptyComponent={<Text style={styles.empty}>Nobody has shared an album with you yet.</Text>}
        renderItem={({ item }) => (
          <Pressable
            testID={`albums-shared-item-${item.album.id}`}
            style={styles.row}
            onPress={() => router.push(`/settings/albums/${item.album.id}` as never)}
          >
            <Text style={styles.rowTitle}>{item.album.name}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '700' },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginTop: 12 },
  createRow: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  createButton: { backgroundColor: '#208AEF', borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center' },
  buttonDisabled: { backgroundColor: '#a9c9e8' },
  createButtonText: { color: '#fff', fontWeight: '600' },
  error: { color: '#B00020', fontSize: 13 },
  empty: { color: '#777', fontSize: 13, paddingVertical: 6 },
  row: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e2e2',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rowTitle: { fontSize: 15, color: '#222' },
  rowMeta: { fontSize: 13, color: '#777' },
});
