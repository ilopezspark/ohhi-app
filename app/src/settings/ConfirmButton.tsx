import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

export interface ConfirmButtonProps {
  testID: string;
  label: string;
  busy: boolean;
  /** Disabled for a reason other than being busy (e.g. no category picked yet). */
  disabled?: boolean;
  destructive?: boolean;
  onPress: () => void;
}

/** A single final-action button (block, delete account, ...), shared styling. */
export function ConfirmButton({ testID, label, busy, disabled = false, destructive = true, onPress }: ConfirmButtonProps) {
  const isDisabled = busy || disabled;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      style={[styles.button, destructive && styles.destructive, isDisabled && styles.disabled]}
      onPress={onPress}
    >
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.text}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { backgroundColor: '#208AEF', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  destructive: { backgroundColor: '#B00020' },
  disabled: { opacity: 0.6 },
  text: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
