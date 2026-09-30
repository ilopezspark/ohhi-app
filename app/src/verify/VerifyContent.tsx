import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Button, Text } from '../ui';
import { colors, spacing } from '../theme/tokens';
import type { VerifyFlow } from './useVerifyFlow';
import {
  CONTACT_SUPPORT,
  SUPPORT_URL,
  triesLeftLine,
  VERIFY_BUTTON,
  VERIFY_COPY,
  VERIFY_SMALL_PRINT,
} from './verifyState';

/**
 * The verify step's words (`docs/age-gate-contract.md`'s copy, through
 * `verify/verifyState.ts`): title, body, the tries-left line, the small print
 * before a first try, the neutral start error, and the support link when no
 * tries are left. Rendered by the onboarding step, `finish` and the
 * standalone verify screen, each in its own frame.
 */
export function VerifyBody({ flow, testID = 'verify' }: { flow: VerifyFlow; testID?: string }) {
  if (!flow.ready) {
    return (
      <View style={styles.loading} testID={`${testID}-loading`}>
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  }
  if (flow.view === 'verified') return null;

  const copy = VERIFY_COPY[flow.view];
  return (
    <View style={styles.body} testID={`${testID}-state-${flow.view}`}>
      <Text variant="headline" testID={`${testID}-title`}>
        {copy.title}
      </Text>
      <Text variant="body" color={colors.muted} testID={`${testID}-body`}>
        {copy.body}
      </Text>
      {flow.view === 'retry' && flow.attemptsLeft !== null ? (
        <Text variant="bodyStrong" testID={`${testID}-tries-left`}>
          {triesLeftLine(flow.attemptsLeft)}
        </Text>
      ) : null}
      {flow.view === 'final' ? <SupportLink testID={`${testID}-support`} /> : null}
      {flow.error ? (
        <Text variant="helper" color={colors.danger} testID={`${testID}-error`}>
          {flow.error}
        </Text>
      ) : null}
      {flow.view === 'start' ? (
        <Text variant="helper" color={colors.subtle} testID={`${testID}-small-print`}>
          {VERIFY_SMALL_PRINT}
        </Text>
      ) : null}
    </View>
  );
}

export interface VerifyActionsProps {
  flow: VerifyFlow;
  /**
   * Onboarding's own step: a check that is running or under review does not
   * hold up the rest of the profile, so those states offer `continue` on to
   * the next step (`onNext`). Everywhere else (finish, the standalone
   * screen) those states wait: row 6's `continue` resumes the Persona window
   * instead, and only when it was closed early (`flow.resumeAvailable`).
   */
  onNext?: () => void;
  testID?: string;
}

/** The button for the current state, or nothing (row 7 and row 9 have none). */
export function VerifyActions({ flow, onNext, testID = 'verify' }: VerifyActionsProps) {
  if (!flow.ready) return null;
  const start = () => void flow.start();

  switch (flow.view) {
    case 'start':
      return <Button testID={`${testID}-start`} label={VERIFY_BUTTON.start} loading={flow.busy} onPress={start} />;
    case 'retry':
      return <Button testID={`${testID}-retry`} label={VERIFY_BUTTON.retry} loading={flow.busy} onPress={start} />;
    case 'checking':
    case 'closer_look':
      if (onNext) return <Button testID={`${testID}-next`} label="continue" onPress={onNext} />;
      if (flow.view === 'checking' && flow.resumeAvailable) {
        return <Button testID={`${testID}-resume`} label={VERIFY_BUTTON.resume} loading={flow.busy} onPress={start} />;
      }
      return null;
    default:
      return null;
  }
}

export function SupportLink({ testID }: { testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={CONTACT_SUPPORT}
      onPress={() => void Linking.openURL(SUPPORT_URL).catch(() => {})}
      hitSlop={8}
    >
      <Text variant="bodyStrong" color={colors.signal}>
        {CONTACT_SUPPORT}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.lgXl },
  loading: { paddingVertical: spacing.huge, alignItems: 'center' },
});
