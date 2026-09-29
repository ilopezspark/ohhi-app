import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { router, useNavigation } from 'expo-router';
import { usePreventRemove, type NavigationAction } from 'expo-router/react-navigation';

export interface DiscardGuard {
  /** `cancel`: leaves straight away when nothing changed, else asks first. */
  requestClose: () => void;
  /** A deliberate exit (after `save`): leaves without asking. */
  leave: () => void;
}

/**
 * Unsaved-changes handling for the editor's pushed field screens (place,
 * prompts, usual places), the same way `profile-editor/index.tsx` does it
 * for the whole editor: `cancel` asks before throwing edits away, and
 * `usePreventRemove` catches the other ways out (a swipe back, the Android
 * back button) while there is something to lose. The exit is held in state
 * so the guard has re-rendered as "allowed" before the navigation replays,
 * otherwise the guard would catch our own exit and ask again.
 */
export function useDiscardGuard(dirty: boolean): DiscardGuard {
  const navigation = useNavigation();
  const [exit, setExit] = useState<{ action: NavigationAction | null } | null>(null);

  usePreventRemove(dirty && exit === null, ({ data }) => confirmDiscard(data.action));

  useEffect(() => {
    if (!exit) return;
    if (exit.action) navigation.dispatch(exit.action);
    else router.back();
  }, [exit, navigation]);

  function confirmDiscard(action: NavigationAction | null) {
    Alert.alert('discard changes?', 'the changes you made here have not been saved.', [
      { text: 'keep editing', style: 'cancel' },
      { text: 'discard', style: 'destructive', onPress: () => setExit({ action }) },
    ]);
  }

  return {
    requestClose: () => (dirty ? confirmDiscard(null) : setExit({ action: null })),
    leave: () => setExit({ action: null }),
  };
}
