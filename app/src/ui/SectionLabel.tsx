import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, spacing } from '../theme/tokens';
import { Dot } from './Badge';
import { Text } from './Text';

export interface SectionLabelProps {
  /** Rendered uppercase via `typography.sectionLabel` — pass lowercase copy, per the voice rules (the uppercase transform is presentation only). */
  label: string;
  /** A small signal dot before the label — the editor's "this section is missing something" indicator (`PHOTOS`/`PRIVATE CARD` in `04-editor-edit.png`). */
  signalDot?: boolean;
  /**
   * Right-hand content. A plain string renders as a note in `inkSoft`
   * (`04-editor-edit.png`'s "2 picked" / "3 of 3" / "never on the grid").
   * `weight` (a number) renders as `+N%` in `signalDeep` — the editor's
   * per-section completion weight (`completion.ts#sectionWeight`). Omit
   * both for a bare label (`03-settings.png`'s `ACCOUNT`/`NOTIFICATIONS`
   * group headers).
   */
  note?: string;
  weight?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * `docs/design/me-redesign/brief.md`'s section-label row: uppercase eyebrow
 * text, an optional leading signal dot, and an optional right-hand note or
 * `+N%` weight. Used above every editor card (`photos`, `status`, `here
 * for`, `tags`, `private card`) and every Settings group.
 */
export function SectionLabel({ label, signalDot = false, note, weight, style, testID }: SectionLabelProps) {
  return (
    <View style={[styles.row, style]} testID={testID}>
      <View style={styles.left}>
        {signalDot ? <Dot testID={testID ? `${testID}-dot` : undefined} size={7} /> : null}
        <Text variant="sectionLabel" color={colors.muted}>
          {label}
        </Text>
      </View>
      {weight !== undefined ? (
        <Text variant="labelLg" color={colors.signalDeep} testID={testID ? `${testID}-weight` : undefined}>
          {`+${weight}%`}
        </Text>
      ) : note !== undefined ? (
        <Text variant="micro" color={colors.inkSoft} testID={testID ? `${testID}-note` : undefined}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 20,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: spacing.smMd },
});
