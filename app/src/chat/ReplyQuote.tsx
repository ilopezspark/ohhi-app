import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { colors, spacing } from '../theme/tokens';
import { AlbumIcon, CameraIcon } from '../ui/icons';
import { Text } from '../ui';
import { PlayIcon } from './mediaIcons';
import { QUOTE_LOADING_COPY, QUOTE_UNAVAILABLE_COPY, quoteAccessibilityLabel, type QuoteView } from './replies';

interface Props {
  view: QuoteView;
  /** `you`, or their lowercase name. */
  name: string;
  /** Signed URL for the thumbnail (kept media or an album photo), when there is one. */
  thumbUrl?: string;
  /** Mine sit on the right; the quote lines up with its reply. */
  mine: boolean;
  /** Tapping an available quote: scroll to the message, or open the album story. */
  onPress?: () => void;
  testID: string;
}

const THUMB = 36;

/**
 * The quoted block drawn above a reply (decision 93): who wrote it, one line
 * of what it said (or what its media is), and a small thumbnail for kept
 * media or an album photo.
 *
 * - Limited media (view once or twice) gets a neutral square, never a
 *   thumbnail: a quote has no path to it and never opens it.
 * - An unavailable quote says `unavailable` and nothing else.
 * - A quote whose answer has not come back yet holds its place quietly.
 */
export function ReplyQuote({ view, name, thumbUrl, mine, onPress, testID }: Props) {
  const [thumbFailed, setThumbFailed] = useState(false);
  useEffect(() => setThumbFailed(false), [thumbUrl]);

  const tappable = !!onPress && (view.state === 'message' || view.state === 'album_photo');
  const label = quoteAccessibilityLabel(view, name);

  let line: string;
  let showName = true;
  if (view.state === 'unavailable') {
    line = QUOTE_UNAVAILABLE_COPY;
    showName = false;
  } else if (view.state === 'loading') {
    line = QUOTE_LOADING_COPY;
    showName = false;
  } else if (view.state === 'album_photo') {
    line = 'album photo';
  } else {
    line = view.line;
  }

  const hasThumbSlot =
    (view.state === 'message' && (view.limited || !!view.thumbPath)) || view.state === 'album_photo';
  const showImage = hasThumbSlot && !!thumbUrl && !thumbFailed && !(view.state === 'message' && view.limited);

  const content = (
    <View style={[styles.quote, mine ? styles.quoteMine : styles.quoteTheirs]}>
      <View style={styles.accent} />
      <View style={styles.text}>
        {showName ? (
          <Text variant="caption" color={colors.ink} numberOfLines={1} style={styles.name}>
            {name}
          </Text>
        ) : null}
        <Text variant="captionMuted" numberOfLines={1} testID={`${testID}-line`}>
          {line}
        </Text>
      </View>
      {hasThumbSlot ? (
        <View style={styles.thumb} testID={`${testID}-thumb`}>
          {showImage ? (
            <Image
              source={{ uri: thumbUrl }}
              style={styles.thumbImage}
              resizeMode="cover"
              onError={() => setThumbFailed(true)}
              accessibilityIgnoresInvertColors
              testID={`${testID}-image`}
            />
          ) : (
            <View style={styles.thumbPlaceholder} testID={`${testID}-placeholder`}>
              {view.state === 'album_photo' ? (
                <AlbumIcon size={16} color={colors.subtle} />
              ) : view.state === 'message' && view.mediaKind === 'video' ? (
                <PlayIcon size={14} color={colors.subtle} />
              ) : (
                <CameraIcon size={16} color={colors.subtle} />
              )}
            </View>
          )}
        </View>
      ) : null}
    </View>
  );

  if (!tappable) {
    return (
      <View testID={testID} accessible accessibilityLabel={label}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={view.state === 'album_photo' ? 'opens the album' : 'shows the message'}
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  quote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smMd,
    maxWidth: 260,
    minWidth: 120,
    paddingVertical: spacing.xs,
    paddingRight: spacing.xs,
    borderRadius: 14,
    backgroundColor: colors.tint,
    overflow: 'hidden',
  },
  quoteMine: { alignSelf: 'flex-end' },
  quoteTheirs: { alignSelf: 'flex-start' },
  accent: { width: 3, alignSelf: 'stretch', backgroundColor: colors.signal, borderRadius: 2 },
  text: { flexShrink: 1, flexGrow: 1, paddingVertical: 2 },
  name: { fontWeight: '600' },
  thumb: { width: THUMB, height: THUMB, borderRadius: 8, overflow: 'hidden' },
  thumbImage: { width: '100%', height: '100%' },
  thumbPlaceholder: {
    flex: 1,
    backgroundColor: colors.dashed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
});
