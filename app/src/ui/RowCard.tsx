import { Children, isValidElement, cloneElement, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, hairline, radii, shadows } from '../theme/tokens';

export interface RowCardProps {
  /** Each child renders as one row, hairline-separated — the last child gets no divider automatically (mirrors `ui/ListRow.tsx`'s own `last` convention, applied here so callers don't have to track it themselves). */
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * `docs/design/me-redesign/brief.md`'s white, hairline-separated container —
 * the shape behind "only for people you choose" (private card / albums),
 * every Settings group, and the editor's status/here-for/tags/private-card
 * cards. A thin structural wrapper only: children own their own content and
 * padding (typically `ui/SettingsRow` or a custom row), this just supplies
 * the card chrome and the divider between rows.
 */
export function RowCard({ children, style, testID }: RowCardProps) {
  const items = Children.toArray(children).filter(Boolean);

  return (
    <View style={[styles.card, shadows.card, style]} testID={testID}>
      {items.map((child, i) => {
        const isLast = i === items.length - 1;
        if (isValidElement<{ style?: StyleProp<ViewStyle> }>(child)) {
          return cloneElement(child, {
            key: child.key ?? i,
            style: [!isLast && styles.divider, child.props.style],
          });
        }
        return (
          <View key={i} style={!isLast ? styles.divider : undefined}>
            {child}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.paperRaised,
    borderRadius: radii.card,
    overflow: 'hidden',
  },
  divider: {
    borderBottomWidth: hairline.width,
    borderBottomColor: colors.lineSoft,
  },
});
