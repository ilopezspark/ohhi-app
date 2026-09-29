import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform } from 'react-native';

export interface StoryTimerOptions {
  /** How long one photo shows, in ms. */
  duration: number;
  /** Whether the timer is running right now (see `storyNav.storyTimerRuns`). */
  running: boolean;
  /**
   * Identifies the photo being timed. A new key starts from zero: a new
   * photo, or the same photo restarted (tap back on the first one).
   */
  resetKey: string;
  /** Called once when the photo's time is up. */
  onDone: () => void;
}

/** The native driver is not available on web; there the bar animates in JS. */
const NATIVE_DRIVER = Platform.OS !== 'web';

/**
 * The story's per-photo timer.
 *
 * Two clocks on purpose. The time that decides when the story moves on is
 * a plain `setTimeout` for whatever is left of the photo's `duration`,
 * measured with `Date.now()`; the bar is an `Animated.timing` over the same
 * remaining time, on the native driver where there is one, so it fills
 * smoothly without the JS thread. Keeping the decision off the animation
 * means a dropped frame, a stopped native animation or a test environment
 * can never skip or stall a photo.
 *
 * Pausing (`running` false) keeps what is left; resuming carries on from
 * there, with the bar set back to exactly that point first so the two never
 * drift apart. A new `resetKey` starts from zero.
 */
export function useStoryTimer({ duration, running, resetKey, onDone }: StoryTimerOptions): Animated.Value {
  const progress = useRef(new Animated.Value(0)).current;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const state = useRef({ key: resetKey, remaining: duration });

  useEffect(() => {
    const s = state.current;
    if (s.key !== resetKey) {
      s.key = resetKey;
      s.remaining = duration;
    }
    progress.setValue(duration > 0 ? 1 - s.remaining / duration : 0);
    if (!running || s.remaining <= 0) return;

    const startedAt = Date.now();
    const timer = setTimeout(() => {
      s.remaining = 0;
      onDoneRef.current();
    }, s.remaining);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: s.remaining,
      easing: Easing.linear,
      useNativeDriver: NATIVE_DRIVER,
      isInteraction: false,
    });
    animation.start();

    return () => {
      clearTimeout(timer);
      animation.stop();
      if (s.remaining > 0) s.remaining = Math.max(0, s.remaining - (Date.now() - startedAt));
    };
  }, [resetKey, running, duration, progress]);

  return progress;
}
