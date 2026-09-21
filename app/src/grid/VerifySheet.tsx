import { StyleSheet, View } from 'react-native';
import { Button, CheckIcon, Sheet, Text } from '../ui';
import { colors, radii, spacing } from '../theme/tokens';

export interface VerifySheetProps {
  visible: boolean;
  busy?: boolean;
  onVerify: () => void;
  onDismiss: () => void;
}

/**
 * `Grid-Verify.html` — the in-app verification prompt. Replaces the grid's
 * "not visible because unverified/id_failed" banner action, which used to
 * jump straight to `startAndOpenVerification()`'s external Persona flow with
 * no in-app step in between. Now that action opens this sheet instead;
 * "verify now" is the one thing that still calls `startAndOpenVerification`,
 * and "just look around for now" only dismisses — matching the design's two
 * buttons, where the app previously offered no dismiss option at all.
 */
export function VerifySheet({ visible, busy = false, onVerify, onDismiss }: VerifySheetProps) {
  if (!visible) return null;

  return (
    <Sheet testID="grid-verify-sheet" onDismiss={onDismiss}>
      <View style={styles.badge}>
        <CheckIcon size={24} color={colors.ink} />
      </View>
      <Text variant="headline" style={styles.title}>
        real students only.
      </Text>
      <Text variant="body" color={colors.muted}>
        you can look at the grid now. to say hi, verify with your student ID and a quick selfie. takes about a
        minute. we check it and then delete it — we never keep your ID.
      </Text>
      <Button
        testID="grid-verify-sheet-verify"
        label="verify now"
        variant="primary"
        loading={busy}
        onPress={onVerify}
      />
      <Button
        testID="grid-verify-sheet-dismiss"
        label="just look around for now"
        variant="ghost"
        disabled={busy}
        onPress={onDismiss}
      />
      <Text variant="helper" style={styles.footer}>
        verification by Persona · what we do with your ID
      </Text>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: 56,
    height: 56,
    borderRadius: radii.circle,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 30 },
  footer: { textAlign: 'center', color: colors.subtle, fontSize: 11 },
});
