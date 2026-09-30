import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { colors } from '../theme/tokens';
import { Header, type HeaderProps } from './Header';
import { useHeaderInsets } from './useHeaderInsets';

export interface ScreenHeaderProps extends HeaderProps {
  /**
   * The strip's own style: its background (paper by default, painted up
   * behind the status bar) or extra bottom padding. The top padding and the
   * side gutter are the shared ones and are not meant to be overridden.
   */
  containerStyle?: StyleProp<ViewStyle>;
  /** Status bar icons: dark on the paper heading. `null` leaves them to whoever else sets them. */
  statusBarStyle?: 'dark' | 'light' | null;
}

/**
 * A screen's heading, placed at the top of the screen's root view (outside
 * any scroll view, so it stays put and content scrolls under it).
 *
 * The strip starts at the very top edge and paints the status bar area, then
 * the row sits `useHeaderInsets().top` down with the shared side gutter: the
 * Me screen's heading padding, on every screen (owner ruling, 29 September
 * 2026). The row itself is `Header`: an optional back (or close) button, a
 * lowercase title, and optional center and right slots.
 */
export function ScreenHeader({ containerStyle, statusBarStyle = 'dark', title, ...header }: ScreenHeaderProps) {
  const { top, gutter } = useHeaderInsets();
  return (
    <View
      style={[styles.strip, { paddingTop: top, paddingHorizontal: gutter }, containerStyle]}
      testID={header.testID ? `${header.testID}-strip` : 'screen-header'}
    >
      {statusBarStyle ? <StatusBar style={statusBarStyle} /> : null}
      <Header {...header} title={title?.toLowerCase()} />
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { backgroundColor: colors.paper },
});
