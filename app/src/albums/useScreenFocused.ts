import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

/**
 * Whether this screen is the one on top. The story pauses while it is not
 * (the owner's profile opened from the header, the edit grid pushed on top).
 */
export function useScreenFocused(): boolean {
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );
  return focused;
}
