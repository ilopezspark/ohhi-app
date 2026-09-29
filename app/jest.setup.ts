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
