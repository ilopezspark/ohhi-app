import { useEffect, useState } from 'react';
import { Image, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';
import { Button, Chip, Sheet, Text } from '../ui';
import { PlayIcon } from './mediaIcons';
import { fitMedia, sizeFromLoadEvent, type MediaSize } from './mediaLayout';

export type ViewLimitChoice = null | 1 | 2;

export interface MediaPreviewAsset {
  kind: 'photo' | 'video';
  /** Local preview URI (freshly picked) or a signed URL (recently-shared resend). */
  uri: string;
  /** Video only — a static poster frame to show under the play glyph. */
  posterUri?: string | null;
  /** Pixel size as the picker (or `messages.media_width/height`) reported it, so the frame is the right shape before the image loads. */
  width?: number | null;
  height?: number | null;
}

export interface MediaPreviewProps {
  visible: boolean;
  asset: MediaPreviewAsset | null;
  sending: boolean;
  error?: string | null;
  onDismiss: () => void;
  onSend: (viewLimit: ViewLimitChoice) => void;
}

const OPTIONS: { value: ViewLimitChoice; key: string; label: string }[] = [
  { value: 1, key: 'once', label: 'view once' },
  { value: 2, key: 'twice', label: 'view twice' },
  { value: null, key: 'keep', label: 'keep in chat' },
];

/** Tallest the preview frame gets: this, or 45% of the window, whichever is smaller. */
const PREVIEW_MAX_HEIGHT = 360;
/** Widest the preview frame gets on a wide (web/tablet) window. */
const PREVIEW_MAX_WIDTH = 560;

/**
 * The URI to draw in the frame, or `null` for "draw the placeholder".
 *
 * A video's own URI is never handed to `Image` — it can't decode video, and
 * that is what rendered a broken frame whenever the poster step came back
 * empty (web has no `expo-video-thumbnails`; native can fail on odd codecs).
 * An empty string (a recently-shared tile whose signed URL hadn't arrived)
 * is a placeholder too, never `source={{ uri: '' }}`.
 */
export function previewSourceUri(asset: MediaPreviewAsset): string | null {
  const uri = asset.kind === 'video' ? asset.posterUri : asset.uri;
  return uri ? uri : null;
}

/**
 * The preview step between picking (or choosing from the recently-shared
 * tray) and sending — `docs/chat-media-plan.md` §7's three-way view-limit
 * selector, defaulting to keep-in-chat.
 *
 * No design mock exists for this screen (new with this feature, per the task
 * brief — `Chat-Share.html` only covers the tray this sits behind). Built
 * from the same `Sheet`/`Chip`/`Button`/`Text` primitives and token set as
 * every other sheet in the kit rather than inventing new chrome.
 *
 * The frame is sized to the media's own aspect ratio (picker size first,
 * then the decoded image's real size once it loads), contained in the
 * sheet's width and a max height, and centred — the whole photo shows, never
 * a crop of it.
 */
export function MediaPreview({ visible, asset, sending, error, onDismiss, onSend }: MediaPreviewProps) {
  const [viewLimit, setViewLimit] = useState<ViewLimitChoice>(null);
  const [loadedSize, setLoadedSize] = useState<MediaSize | null>(null);
  const [failed, setFailed] = useState(false);
  const [boxWidth, setBoxWidth] = useState<number | null>(null);
  const win = useWindowDimensions();

  const sourceUri = asset ? previewSourceUri(asset) : null;

  // Reset to the default (keep in chat) every time a new asset is presented.
  useEffect(() => {
    if (visible) setViewLimit(null);
  }, [visible, asset?.uri]);

  useEffect(() => {
    setLoadedSize(null);
    setFailed(false);
  }, [sourceUri]);

  if (!visible || !asset) return null;

  const maxWidth = Math.min(boxWidth ?? win.width - spacing.xlXxl * 2, PREVIEW_MAX_WIDTH);
  const maxHeight = Math.min(PREVIEW_MAX_HEIGHT, Math.round(win.height * 0.45));
  const frame = fitMedia(loadedSize ?? { width: asset.width ?? undefined, height: asset.height ?? undefined }, {
    maxWidth,
    maxHeight,
    fallbackAspect: asset.kind === 'video' ? 16 / 9 : 4 / 3,
  });
  const showImage = !!sourceUri && !failed;

  return (
    <Sheet onDismiss={sending ? undefined : onDismiss} testID="media-preview-sheet">
      <Text variant="title" style={styles.title}>
        {asset.kind === 'video' ? 'send a video' : 'send a photo'}
      </Text>

      <View
        style={styles.previewArea}
        onLayout={(event: LayoutChangeEvent) => setBoxWidth(Math.round(event.nativeEvent.layout.width))}
        testID="media-preview-area"
      >
        <View style={[styles.previewFrame, { width: frame.width, height: frame.height }]} testID="media-preview-box">
          {showImage ? (
            <Image
              source={{ uri: sourceUri }}
              style={styles.previewImage}
              resizeMode="contain"
              onLoad={(event) => {
                const size = sizeFromLoadEvent(event);
                if (size) setLoadedSize(size);
              }}
              onError={() => setFailed(true)}
              accessibilityIgnoresInvertColors
              testID="media-preview-image"
            />
          ) : (
            <View style={styles.placeholder} testID="media-preview-placeholder" />
          )}
          {asset.kind === 'video' ? (
            <View style={styles.playOverlay} pointerEvents="none" testID="media-preview-play-overlay">
              <View style={styles.playBadge}>
                <PlayIcon size={24} color={colors.onDark} />
              </View>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.options} testID="media-preview-options">
        {OPTIONS.map((option) => (
          <Chip
            key={option.key}
            label={option.label}
            selected={viewLimit === option.value}
            onPress={() => setViewLimit(option.value)}
            testID={`media-preview-option-${option.key}`}
          />
        ))}
      </View>

      {viewLimit != null ? (
        <Text variant="helper" testID="media-preview-limited-copy">
          They can open it {viewLimit === 1 ? 'once' : 'twice'} — it won&apos;t stay in the chat after that.
        </Text>
      ) : null}

      {error ? (
        <Text variant="helper" color={colors.danger} testID="media-preview-error">
          {error}
        </Text>
      ) : null}

      <Button label="send" loading={sending} onPress={() => onSend(viewLimit)} testID="media-preview-send" />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17 },
  previewArea: { width: '100%', alignItems: 'center' },
  previewFrame: {
    borderRadius: radii.lg,
    backgroundColor: colors.dashed,
    overflow: 'hidden',
  },
  previewImage: { width: '100%', height: '100%' },
  placeholder: { flex: 1, backgroundColor: colors.dashed },
  playOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBadge: {
    width: 52,
    height: 52,
    borderRadius: radii.circle,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  options: { flexDirection: 'row', gap: spacing.smMd, flexWrap: 'wrap' },
});
