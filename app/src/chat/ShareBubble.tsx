import { Pressable, StyleSheet, View } from 'react-native';
import type { AlbumRow } from '../api/albums';
import { PrivateCardView } from '../me/card/PrivateCardView';
import { colors, radii, shadows, spacing } from '../theme/tokens';
import { AlbumIcon } from '../ui/icons';
import { Text } from '../ui';
import type { ShareFeedItem } from './shareFeed';

interface Props {
  item: ShareFeedItem;
  /** True when I'm `ownerId` — the outgoing/"mine" bubble style (`Chat-Album.html`'s "more of me"). */
  mine: boolean;
  /** First name of whichever side isn't me, for the private-card bubble's copy. */
  otherName: string;
  /** Only for `kind: 'album'` — loaded by the thread screen, may still be loading. */
  album?: AlbumRow;
  onPress: () => void;
}

/**
 * The inline "you/they shared …" bubble `Chat-Album.html` shows nested inside
 * the message flow — an album ("more of me", tap to view · N photos) or the
 * private card ("maya shared more about her"). Not a `messages` row: this
 * renders a `shares` row merged into the thread feed by the screen
 * (`shareFeed.ts`), interleaved with real messages by `created_at`.
 *
 * Deviation from the mockup: the design shows a blurred 6-photo preview grid
 * inside the album bubble. This renders the album name + photo count instead
 * of fetching and rendering thumbnails for every shared album on every
 * thread open — the tap target and "shared until you unshare" framing are
 * kept, the photo grid itself is not reproduced. Flagged, not silently
 * dropped.
 *
 * The private-card branch renders through `me/card/PrivateCardView` (the
 * same component `/me/private-card`'s own "how it arrives in a chat"
 * preview uses), header-only (no `entries` — this bubble carries no card
 * content, only the ids `chat/shareFeed.ts#ShareFeedItem` gives it), so the
 * title/lock/`private` styling is guaranteed identical in both places
 * instead of a second, hand-copied rendering of the same three pieces.
 */
export function ShareBubble({ item, mine, otherName, album, onPress }: Props) {
  const isAlbum = item.kind === 'album';

  const title = album?.name ?? 'an album';
  const subtitle = isAlbum
    ? album
      ? `${album.photo_count} photo${album.photo_count === 1 ? '' : 's'} · tap to view`
      : 'tap to view'
    : mine
      ? 'you shared this · tap to manage'
      : 'tap to open';

  const content = (
    <View
      style={[styles.card, mine ? styles.cardMine : styles.cardTheirs]}
      testID={`share-bubble-${item.id}`}
    >
      {isAlbum ? (
        <>
          <View style={[styles.icon, styles.iconAlbum]}>
            <AlbumIcon size={18} color={colors.ink} />
          </View>
          <View style={styles.body}>
            <Text variant="rowLabel" style={{ fontSize: 13 }} color={mine ? colors.onDark : colors.ink}>
              {title}
            </Text>
            <Text variant="captionMuted" color={mine ? colors.onDark : colors.subtle} style={styles.subtitle}>
              {subtitle}
            </Text>
          </View>
        </>
      ) : (
        <View style={styles.body}>
          <PrivateCardView
            name={mine ? 'you' : otherName}
            titleColor={mine ? colors.onDark : colors.ink}
            mutedColor={mine ? colors.onDark : colors.subtle}
            testID={`share-bubble-${item.id}-card`}
          />
          <Text variant="captionMuted" color={mine ? colors.onDark : colors.subtle} style={styles.subtitle}>
            {subtitle}
          </Text>
        </View>
      )}
    </View>
  );

  // Every bubble opens something: an album, the full private card they
  // shared with me (`chat/PrivateCardSheet.tsx`), or, for my own card, my
  // card screen where I can see who has it and take it back.
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isAlbum ? `open ${title}` : mine ? 'your private card' : `more about ${otherName}`}
      onPress={onPress}
      testID={`share-bubble-press-${item.id}`}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.mdLg,
    maxWidth: '78%',
    padding: spacing.smMd,
    borderRadius: radii.lg,
  },
  cardMine: { backgroundColor: colors.ink, alignSelf: 'flex-end', borderBottomRightRadius: spacing.smMd },
  cardTheirs: { backgroundColor: colors.surface, alignSelf: 'flex-start', borderBottomLeftRadius: spacing.smMd, ...shadows.xs },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radii.smAvatar,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  iconAlbum: { backgroundColor: colors.avatarTints[2] },
  body: { gap: 2, flexShrink: 1 },
  subtitle: { opacity: 0.85 },
});
