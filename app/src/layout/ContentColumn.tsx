import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useContentWidth } from './useContentWidth';

export interface ContentColumnProps {
  children?: ReactNode;
  /** Defaults to `useContentWidth()`'s own cap (520) — pass a wider one for sheets (~480 is narrower on purpose; forms want the full 520). */
  maxWidth?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Centres `children` in a column capped at `maxWidth` on wide windows, full
 * width under the cap. Used by `OnboardingScreen` and single-column settings
 * screens (`docs/app-responsive-plan.md`) so the 8-segment progress bar,
 * footer buttons and form fields size to the column, not the window, on
 * medium/expanded — while staying edge-to-edge, unchanged, on compact.
 */
export function ContentColumn({ children, maxWidth, style, testID }: ContentColumnProps) {
  const width = useContentWidth(maxWidth);
  return (
    <View style={styles.outer} testID={testID}>
      <View style={[{ width, maxWidth: width }, style]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { width: '100%', alignItems: 'center' },
});
