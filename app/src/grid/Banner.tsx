import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

export interface BannerProps {
  message: string;
  actionLabel?: string | null;
  onAction?: () => void;
  busy?: boolean;
  tone?: 'info' | 'warning';
  testID?: string;
  actionTestID?: string;
}

/**
 * The one banner shape used for all of §3's persistent grid banners: the
 * paused banner, the "you're not visible because…" banner (§3.1) and the
 * verification prompt (§5). One component so the copy is the only thing that
 * varies between them — and so no banner can accidentally grow a "why" that
 * decision 24 doesn't allow.
 */
export function Banner({
  message,
  actionLabel,
  onAction,
  busy = false,
  tone = 'info',
  testID,
  actionTestID,
}: BannerProps) {
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      style={[styles.banner, tone === 'warning' ? styles.warning : styles.info]}
    >
      <Text style={styles.message}>{message}</Text>
      {actionLabel && onAction ? (
        <Pressable
          testID={actionTestID}
          accessibilityRole="button"
          disabled={busy}
          onPress={onAction}
          style={[styles.action, busy && styles.actionDisabled]}
        >
          {busy ? <ActivityIndicator size="small" /> : <Text style={styles.actionText}>{actionLabel}</Text>}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    marginHorizontal: 12,
    marginTop: 8,
  },
  info: { backgroundColor: '#EAF3FD' },
  warning: { backgroundColor: '#FDF1E7' },
  message: { flex: 1, fontSize: 13, color: '#20303F' },
  action: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#208AEF' },
  actionDisabled: { opacity: 0.6 },
  actionText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
