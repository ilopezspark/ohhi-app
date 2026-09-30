import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, spacing } from '../theme/tokens';
import { Text } from './Text';

export interface SegmentedTab<T extends string> {
  key: T;
  /** Lowercase copy, per the voice rules. */
  label: string;
  testID?: string;
}

export interface SegmentedTabsProps<T extends string> {
  tabs: ReadonlyArray<SegmentedTab<T>>;
  value: T;
  onChange: (key: T) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * An equal-width tab row with an ink underline under the selected tab — the
 * profile editor's old edit/preview row, extracted so other screens (the
 * hi's tab's received/sent) share it.
 */
export function SegmentedTabs<T extends string>({ tabs, value, onChange, style, testID }: SegmentedTabsProps<T>) {
  return (
    <View style={[styles.row, style]} testID={testID} accessibilityRole="tablist">
      {tabs.map((tab) => {
        const active = tab.key === value;
        return (
          <Pressable
            key={tab.key}
            testID={tab.testID}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(tab.key)}
            style={styles.button}
          >
            <Text variant="bodyStrong" color={active ? colors.ink : colors.inkFaint}>
              {tab.label}
            </Text>
            <View style={[styles.underline, active && styles.underlineActive]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingHorizontal: spacing.lgXl, borderBottomWidth: 1, borderBottomColor: colors.line },
  button: { flex: 1, alignItems: 'center', paddingBottom: spacing.mdLg, gap: spacing.smMd },
  underline: { height: 2, width: '100%', backgroundColor: 'transparent' },
  underlineActive: { backgroundColor: colors.ink },
});
