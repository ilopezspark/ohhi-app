import { Platform } from 'react-native';

/**
 * Thin wrapper so screens (and their tests) can gate on "web" without
 * touching `react-native`'s `Platform` module directly — mocking `Platform`
 * itself pulls in real native-module internals under Jest (jest-expo's own
 * `react-native` mock gets bypassed by a `jest.requireActual`), which is
 * fragile. Mocking this one-line module instead is cheap and stable.
 */
export function isWeb(): boolean {
  return Platform.OS === 'web';
}
