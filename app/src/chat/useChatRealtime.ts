import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { getRealtimeManager, type MessageEvent } from '../realtime';

export type { MessageEvent };

interface ChatRealtimeOptions {
  onMessage: (message: MessageEvent) => void;
  onInvalidate?: (reason: 'subscribed' | 'foreground') => void;
}

/**
 * Handlers are held in a ref and read at call time, so a caller passing inline
 * closures (the normal case) doesn't resubscribe on every render — the effect
 * depends only on the id.
 */
function useStableHandlers(options: ChatRealtimeOptions) {
  const ref = useRef(options);
  ref.current = options;
  return ref;
}

/**
 * Per-open-thread subscription, mount/unmount-scoped (plan §3).
 *
 * Also reconnects on foreground: supabase-js restores the socket itself, but a
 * backgrounded session can have missed inserts entirely, so the manager
 * re-auths and fires `onInvalidate('foreground')` and the thread refetches
 * rather than trusting the socket to have caught up.
 */
export function useConversationRealtime(
  conversationId: string | null | undefined,
  options: ChatRealtimeOptions
): void {
  const handlers = useStableHandlers(options);

  useEffect(() => {
    if (!conversationId) return;
    const manager = getRealtimeManager();

    const unsubscribe = manager.subscribeConversation(conversationId, {
      onMessage: (message) => handlers.current.onMessage(message),
      onInvalidate: (reason) => handlers.current.onInvalidate?.(reason),
    });

    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') manager.reconnect();
    });

    return () => {
      subscription.remove();
      unsubscribe();
    };
  }, [conversationId, handlers]);
}

/** One list-level subscription across every readable `messages` insert. */
export function useMessageListRealtime(options: ChatRealtimeOptions): void {
  const handlers = useStableHandlers(options);

  useEffect(() => {
    const manager = getRealtimeManager();

    const unsubscribe = manager.subscribeMessageList({
      onMessage: (message) => handlers.current.onMessage(message),
      onInvalidate: (reason) => handlers.current.onInvalidate?.(reason),
    });

    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') manager.reconnect();
    });

    return () => {
      subscription.remove();
      unsubscribe();
    };
  }, [handlers]);
}
