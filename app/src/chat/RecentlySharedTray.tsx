import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import type { RecentlySharedItem } from '../api/messages';
import { colors, radii, spacing } from '../theme/tokens';
import { Text } from '../ui';
import { PlayIcon } from './mediaIcons';
import { StorageImage } from '../ui/StorageImage';

export interface RecentlySharedTrayProps {
  items: RecentlySharedItem[] | undefined;
  loading: boolean;
  /** path -> signed `chat-media` URL. Keyed by `mediaPath` for a photo row, `mediaPosterPath` for a video row. */
  thumbnailUrls: Record<string, string>;
  onSelect: (item: RecentlySharedItem) => void;
}

/**
 * `docs/chat-media-plan.md` §5/§7: a horizontal strip of the sender's 30 most
 * recent distinct keep-in-chat sends, shown inside the share sheet's "a photo
 * or video" step, above "browse camera roll". Tapping a tile skips the picker
 * and goes straight to `MediaPreview` (any of the three options may still be
 * chosen — §2's copy-on-resend).
 *
 * Purely presentational: `items`/`thumbnailUrls` come from
 * `api/messages.ts#listRecentlySharedMedia` + `api/chatMedia.ts
 * #signedChatMediaUrls`, both called by the thread screen.
 */
export function RecentlySharedTray({ items, loading, thumbnailUrls, onSelect }: RecentlySharedTrayProps) {
  if (loading) return null;

  if (!items || items.length === 0) {
    return (
      <Text variant="helper" testID="recently-shared-empty">
        Nothing recently shared yet.
      </Text>
    );
  }

  return (
    <FlatList
      testID="recently-shared-tray"
      horizontal
      showsHorizontalScrollIndicator={false}
      data={items}
      keyExtractor={(item) => item.messageId}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => {
        const thumbPath = item.mediaKind === 'video' ? (item.mediaPosterPath ?? item.mediaPath) : item.mediaPath;
        const uri = thumbnailUrls[thumbPath];
        return (
          <Pressable
            accessibilityRole="button"
            testID={`recently-shared-item-${item.messageId}`}
            onPress={() => onSelect(item)}
            style={styles.tile}
          >
            {uri ? (
              // A square thumbnail is a crop by design; the preview it opens
              // shows the whole image.
              <StorageImage
                uri={uri}
                style={StyleSheet.absoluteFill}
                accessibilityIgnoresInvertColors
                testID={`recently-shared-image-${item.messageId}`}
              />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.placeholder]} testID={`recently-shared-placeholder-${item.messageId}`} />
            )}
            {item.mediaKind === 'video' ? (
              <View style={styles.playBadge}>
                <PlayIcon size={14} color={colors.onDark} />
              </View>
            ) : null}
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.smMd },
  tile: {
    width: 76,
    height: 76,
    borderRadius: radii.sm,
    backgroundColor: colors.dashed,
    overflow: 'hidden',
  },
  placeholder: { backgroundColor: colors.dashed },
  playBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 20,
    height: 20,
    borderRadius: radii.circle,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
