import { Pressable, StyleSheet, View } from 'react-native';
import { CardTextInput, FieldCard, FieldFooter, Text } from '../../ui';
import { colors, spacing } from '../../theme/tokens';
import { PLACE_LINE_HOURS, PLACE_LINE_MAX_LENGTH } from '../../profile/fields';
import { FieldNote } from './FieldEditorFrame';

/** What the owner is told about their saved line; `null` when there is nothing saved or the field no longer holds it. */
export type PlaceLineStatus = { kind: 'showing'; until: string } | { kind: 'expired' } | { kind: 'away' } | null;

export interface PlaceLineStatusInput {
  /** The field's current text. */
  value: string;
  savedPlaceLine: string | null;
  placeLineUntil: string | null;
  placeLineShown: boolean;
}

/**
 * Whether the saved line is showing, and if not, why — only while the field
 * still holds the saved text (an edit is a new line, not yet saved).
 * `place_line_shown` false with the two hours still running can only mean
 * the owner is away (the server's only other condition).
 */
export function placeLineStatus(input: PlaceLineStatusInput, now: Date = new Date()): PlaceLineStatus {
  const saved = input.savedPlaceLine?.trim();
  if (!saved || input.value.trim() !== saved) return null;
  if (input.placeLineShown && input.placeLineUntil) return { kind: 'showing', until: input.placeLineUntil };
  const until = input.placeLineUntil ? Date.parse(input.placeLineUntil) : NaN;
  if (Number.isNaN(until) || until <= now.getTime()) return { kind: 'expired' };
  return { kind: 'away' };
}

/** `3:40 pm`, lowercase, in the device's time zone. */
export function clockLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${hours < 12 ? 'am' : 'pm'}`;
}

export function placeLineStatusCopy(status: PlaceLineStatus): string | null {
  if (!status) return null;
  if (status.kind === 'showing') return `showing on your profile until ${clockLabel(status.until)}.`;
  if (status.kind === 'expired') {
    return `not showing right now: it's been more than ${PLACE_LINE_HOURS} hours. save it again to show it for another ${PLACE_LINE_HOURS}.`;
  }
  return "not showing right now, because you're not on campus or nearby. it comes back when you are, until the time is up.";
}

/** The standing note under the field. */
export const PLACE_LINE_NOTE = `it shows on your profile for ${PLACE_LINE_HOURS} hours after you save it, and only while you're on campus or nearby.`;

export interface PlaceLineFieldProps {
  value: string;
  onChange: (value: string) => void;
  status?: PlaceLineStatus;
  autoFocus?: boolean;
  testID: string;
}

/**
 * The place line's input: one line, 40 characters, a counter and `clear`,
 * then the note about when it shows and, for a saved line, whether it is
 * showing now. Used by the editor's place screen and by QuickStatus.
 */
export function PlaceLineField({ value, onChange, status = null, autoFocus = false, testID }: PlaceLineFieldProps) {
  const statusCopy = placeLineStatusCopy(status);
  return (
    <View style={styles.wrap}>
      <FieldCard>
        <CardTextInput
          testID={`${testID}-input`}
          accessibilityLabel="where you are"
          autoFocus={autoFocus}
          maxLength={PLACE_LINE_MAX_LENGTH}
          value={value}
          onChangeText={onChange}
          placeholder="library, 2nd floor"
          returnKeyType="done"
        />
        <FieldFooter
          left={
            <Pressable
              testID={`${testID}-clear`}
              accessibilityRole="button"
              accessibilityLabel="clear where you are"
              onPress={() => onChange('')}
              hitSlop={8}
            >
              <Text variant="labelLg" color={colors.muted}>
                clear
              </Text>
            </Pressable>
          }
          counter={{ length: value.length, max: PLACE_LINE_MAX_LENGTH, testID: `${testID}-counter` }}
        />
      </FieldCard>
      <FieldNote text={PLACE_LINE_NOTE} testID={`${testID}-note`} />
      {statusCopy ? (
        <Text variant="micro" color={colors.inkSoft} testID={`${testID}-status`}>
          {statusCopy}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.mdLg },
});
