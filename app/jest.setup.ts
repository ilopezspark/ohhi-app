import { timeoutManager } from '@tanstack/react-query';

/**
 * React Query parks every query and mutation left in a cache after its screen
 * unmounts behind a `gcTime` timer, 5 minutes by default. Test files that build
 * their QueryClient without `gcTime: Infinity` leave those real timers behind,
 * and they keep Node alive, so a suite run on its own sits for minutes after
 * its last test unless `--forceExit` is passed.
 *
 * Unref'd timers still fire on schedule while the process is running; they
 * just no longer hold it open. Set before any QueryClient exists, as
 * `setTimeoutProvider` asks.
 */
type Unrefable = { unref?: () => void };

function unref<T>(timer: T): T {
  (timer as Unrefable).unref?.();
  return timer;
}

timeoutManager.setTimeoutProvider({
  setTimeout: (callback, delay) => unref(setTimeout(callback, delay)),
  clearTimeout: (id) => clearTimeout(id),
  setInterval: (callback, delay) => unref(setInterval(callback, delay)),
  clearInterval: (id) => clearInterval(id),
});

/**
 * `react-native-keyboard-controller` is native-only; its own jest mock
 * reports a closed keyboard (height 0). A test that needs an open keyboard
 * overrides `useReanimatedKeyboardAnimation` itself.
 */
jest.mock('react-native-keyboard-controller', () => require('react-native-keyboard-controller/jest'));

/**
 * Reanimated (used by `ui/KeyboardSpacer.tsx` for the keyboard lift) cannot
 * load its native worklets runtime under Jest, so both are mocked; its own mock runs
 * `useAnimatedStyle` immediately, so a spacer's height is readable in a
 * test. A test file with its own `jest.mock('react-native-reanimated')`
 * still wins over this one.
 */
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
