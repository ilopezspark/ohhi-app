import { useEffect, useState } from 'react';
import { AccessibilityInfo, AppState, Platform, type AppStateStatus } from 'react-native';

export interface SystemPauses {
  /** The app is not in the foreground. */
  backgrounded: boolean;
  /**
   * A screen reader is running, or the system asks for reduced motion. The
   * story then never moves on by itself: people go photo to photo with the
   * adjustable element's increment/decrement, or by tapping.
   */
  manualOnly: boolean;
}

function isBackground(status: AppStateStatus | null | undefined): boolean {
  return status === 'background' || status === 'inactive';
}

/** Promise-or-not results from `AccessibilityInfo`, never allowed to throw. */
function readFlag(read: (() => Promise<boolean> | undefined) | undefined, set: (value: boolean) => void): void {
  try {
    const pending = read?.();
    if (pending && typeof pending.then === 'function') {
      pending.then((value) => set(!!value)).catch(() => {});
    }
  } catch {
    // Unknown means "not on": the story just runs as normal.
  }
}

/** The system-level things that hold a story's timer: the app going to the background, a screen reader, reduced motion. */
export function useSystemPauses(): SystemPauses {
  const [backgrounded, setBackgrounded] = useState(() => isBackground(AppState.currentState));
  const [screenReader, setScreenReader] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    const guard = (set: (value: boolean) => void) => (value: boolean) => {
      if (alive) set(value);
    };

    const appSub = AppState.addEventListener('change', (next) => {
      if (alive) setBackgrounded(isBackground(next));
    });

    // On web a browser cannot tell whether a screen reader is running, and
    // react-native-web's `isScreenReaderEnabled` answers `true` regardless,
    // which would stop every story from moving. There only reduced motion
    // (`prefers-reduced-motion`) counts.
    const detectsScreenReader = Platform.OS !== 'web';
    if (detectsScreenReader) readFlag(() => AccessibilityInfo.isScreenReaderEnabled?.(), guard(setScreenReader));
    readFlag(() => AccessibilityInfo.isReduceMotionEnabled?.(), guard(setReduceMotion));
    const readerSub = detectsScreenReader
      ? AccessibilityInfo.addEventListener?.('screenReaderChanged', guard(setScreenReader))
      : undefined;
    const motionSub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', guard(setReduceMotion));

    return () => {
      alive = false;
      appSub?.remove?.();
      readerSub?.remove?.();
      motionSub?.remove?.();
    };
  }, []);

  return { backgrounded, manualOnly: screenReader || reduceMotion };
}
