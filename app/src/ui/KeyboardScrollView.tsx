import { forwardRef } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, type ScrollViewProps } from 'react-native';

/**
 * A `ScrollView` for a screen of text fields that keeps the focused field
 * above the keyboard on both platforms.
 *
 * - iOS: `automaticallyAdjustKeyboardInsets` insets the scroll view by the
 *   keyboard's overlap and scrolls the focused field into view.
 * - Android: the app is edge-to-edge (always on since SDK 54), so the window
 *   is no longer resized for the keyboard and `KeyboardAvoidingView` with no
 *   `behavior` does nothing. `padding` shrinks the scroll view instead, and
 *   Android's ScrollView keeps the focused field in view when it shrinks.
 *
 * Taps on buttons and chips land while the keyboard is up
 * (`keyboardShouldPersistTaps="handled"`).
 */
export const KeyboardScrollView = forwardRef<ScrollView, ScrollViewProps>(function KeyboardScrollView(props, ref) {
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'android' ? 'padding' : undefined}>
      <ScrollView ref={ref} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets {...props} />
    </KeyboardAvoidingView>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
