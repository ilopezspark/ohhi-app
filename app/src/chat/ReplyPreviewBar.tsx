import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';
import { XIcon } from '../ui/icons';
import { Text } from '../ui';
import { ReplyIcon } from './mediaIcons';
import { replyingToLabel, type ReplyDraft } from './replies';

interface Props {
  draft: ReplyDraft;
  /** Signed URL for a kept photo or video poster, when the replied-to message has one. */
  thumbUrl?: string;
  onCancel: () => void;
}

/**
 * The bar above the composer while a reply is being written: `replying to
 * {name}` (or `yourself`), one line of what is being replied to, a small
 * thumbnail for kept media, and an x to cancel. Sending clears it.
 */
export function ReplyPreviewBar({ draft, thumbUrl, onCancel }: Props) {
  const [thumbFailed, setThumbFailed] = useState(false);
  useEffect(() => setThumbFailed(false), [thumbUrl]);
  const label = replyingToLabel(draft.name);

  return (
    <View style={styles.bar} testID="reply-bar" accessible={false}>
      <ReplyIcon size={18} color={colors.muted} />
      <View style={styles.accent} />
      <View style={styles.text} accessible accessibilityLabel={draft.line ? `${label}, ${draft.line}` : label}>
        <Text variant="caption" color={colors.ink} numberOfLines={1} style={styles.name} testID="reply-bar-name">
          {label}
        </Text>
        {draft.line ? (
          <Text variant="captionMuted" numberOfLines={1} testID="reply-bar-line">
            {draft.line}
          </Text>
        ) : null}
      </View>
      {draft.thumbPath && thumbUrl && !thumbFailed ? (
        <Image
          source={{ uri: thumbUrl }}
          style={styles.thumb}
          resizeMode="cover"
          onError={() => setThumbFailed(true)}
          accessibilityIgnoresInvertColors
          testID="reply-bar-thumb"
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="cancel reply"
        testID="reply-bar-cancel"
        hitSlop={10}
        onPress={onCancel}
        style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
      >
        <XIcon size={16} color={colors.ink} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smMd,
    marginHorizontal: spacing.lgXl,
    marginBottom: spacing.xs,
    paddingVertical: spacing.smMd,
    paddingHorizontal: spacing.mdLg,
    borderRadius: 16,
    backgroundColor: colors.tint,
  },
  accent: { width: 3, alignSelf: 'stretch', backgroundColor: colors.signal, borderRadius: 2 },
  text: { flex: 1, minWidth: 0 },
  name: { fontWeight: '600' },
  thumb: { width: 36, height: 36, borderRadius: 8 },
  cancel: {
    width: 32,
    height: 32,
    borderRadius: radii.circle,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
});
