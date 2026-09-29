import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * A light tap: the press-and-hold menu opening, and a drag starting a reply.
 * `expo-haptics` is part of Expo Go. Web has nothing to tap, and a device
 * without haptics (or with them turned off) just stays quiet: this never
 * throws and never waits.
 */
export function lightTap(): void {
  if (Platform.OS === 'web') return;
  try {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  } catch {
    // No haptics here; nothing to do.
  }
}
