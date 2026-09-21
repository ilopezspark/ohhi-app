import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { spacing } from '../theme/tokens';
import { Text } from './Text';

export interface EmptyStateProps {
  /** `Grid-Empty.html`'s "quiet right now." — `headline` at its 26px override. */
  title: string;
  message?: string;
  /** `Grid-Empty.html`'s illustration `<img>`; this kit ships no imagery, so the caller supplies whatever asset/graphic goes here. */
  icon?: ReactNode;
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** `Grid-Empty.html`'s centred icon + headline + helper-text + optional link/action stack. */
export function EmptyState({ title, message, icon, action, style, testID }: EmptyStateProps) {
  return (
    <View style={[styles.container, style]} testID={testID}>
      {icon}
      <Text variant="headline" style={styles.title}>
        {title}
      </Text>
      {message ? (
        <Text variant="helper" style={styles.message}>
          {message}
        </Text>
      ) : null}
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.xxl,
  },
  title: { fontSize: 26, textAlign: 'center' },
  message: { textAlign: 'center' },
});
