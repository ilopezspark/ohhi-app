import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';
import { Button, Chip, Sheet, Text } from '../ui';
import { PlayIcon } from './mediaIcons';

export type ViewLimitChoice = null | 1 | 2;

export interface MediaPreviewAsset {
  kind: 'photo' | 'video';
  /** Local preview URI (freshly picked) or a signed URL (recently-shared resend). */
  uri: string;
  /** Video only — a static poster frame to show under the play glyph. */
  posterUri?: string | null;
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

/**
 * The preview step between picking (or choosing from the recently-shared
 * tray) and sending — `docs/chat-media-plan.md` §7's three-way view-limit
 * selector, defaulting to keep-in-chat.
 *
 * No design mock exists for this screen (new with this feature, per the task
 * brief — `Chat-Share.html` only covers the tray this sits behind). Built
 * from the same `Sheet`/`Chip`/`Button`/`Text` primitives and token set as
 * every other sheet in the kit rather than inventing new chrome.
 */
export function MediaPreview({ visible, asset, sending, error, onDismiss, onSend }: MediaPreviewProps) {
  const [viewLimit, setViewLimit] = useState<ViewLimitChoice>(null);

  // Reset to the default (keep in chat) every time a new asset is presented.
  useEffect(() => {
    if (visible) setViewLimit(null);
  }, [visible, asset?.uri]);

  if (!visible || !asset) return null;

  const previewUri = asset.kind === 'video' ? asset.posterUri ?? asset.uri : asset.uri;

  return (
    <Sheet onDismiss={sending ? undefined : onDismiss} testID="media-preview-sheet">
      <Text variant="title" style={styles.title}>
        {asset.kind === 'video' ? 'send a video' : 'send a photo'}
      </Text>

      <View style={styles.previewBox} testID="media-preview-box">
        {previewUri ? (
          <Image source={{ uri: previewUri }} style={StyleSheet.absoluteFill} accessibilityIgnoresInvertColors />
        ) : null}
        {asset.kind === 'video' ? (
          <View style={styles.playOverlay} testID="media-preview-play-overlay">
            <PlayIcon size={28} color={colors.onDark} />
          </View>
        ) : null}
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
  previewBox: {
    width: '100%',
    height: 260,
    borderRadius: radii.lg,
    backgroundColor: colors.dashed,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlay,
  },
  options: { flexDirection: 'row', gap: spacing.smMd, flexWrap: 'wrap' },
});
