import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radii, shadows, spacing } from '../theme/tokens';
import { Text } from './Text';

export interface BackButtonProps {
  onPress: () => void;
  /** `.back` is a plain 44x44 circle everywhere; the "More" (··· overflow) button reuses the exact same chrome, so this is that one shape, not just "back". */
  children?: ReactNode;
  accessibilityLabel?: string;
  testID?: string;
}

/** `.back` — the circular icon button used for back/close/overflow across every non-tab screen. Renders whatever glyph `children` supplies (this kit ships no icon set — see `TabBar.tsx`'s icon deviation note). */
export function BackButton({ onPress, children, accessibilityLabel = 'Back', testID }: BackButtonProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.back, shadows.sm, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

export interface HeaderProps {
  /** Page title — rendered as `headline` (`.h1`). Every non-tab screen's header is `<BackButton/> + title`, sometimes with a progress bar or a trailing action between them. */
  title?: string;
  /** `headline`'s own size varies 26-34px by screen (see `theme/tokens.ts`); pass to match, defaults to 28 (`Settings.html`/`Me-Albums.html`'s back-header size, the most common non-34 override). */
  titleSize?: number;
  onBack?: () => void;
  /** Trailing slot — e.g. `Me.html`'s settings-gear button, `Chat-Thread.html`'s overflow (`·`) button. */
  right?: ReactNode;
  /** Fills the space between back button and title — `Onb-*` screens' 8-segment step progress bar. */
  center?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The `<a class="back">… <h1>…</h1></a>` row every non-tab, non-hero screen opens with. */
export function Header({ title, titleSize = 28, onBack, right, center, style, testID }: HeaderProps) {
  return (
    <View style={[styles.header, style]} testID={testID}>
      {onBack ? <BackButton onPress={onBack} /> : null}
      {center}
      {title ? (
        <Text variant="headline" style={[styles.title, { fontSize: titleSize }]} numberOfLines={1}>
          {title}
        </Text>
      ) : null}
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.mdLg,
  },
  title: { flex: 1 },
  back: {
    width: 44,
    height: 44,
    borderRadius: radii.circle,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
});
