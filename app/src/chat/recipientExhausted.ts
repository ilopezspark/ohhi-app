import { create } from 'zustand';

/**
 * Per-message "I (the recipient) already used up my view(s)" flags.
 *
 * `messages.views_used` alone can't answer "has *this device* exhausted its
 * view" without a race (two sessions of the same recipient, a stale cache —
 * `docs/chat-media-plan.md` §7's own note on this). The actual signal is an
 * already-exhausted `media-open` call coming back refused (a plain 404, same
 * as every other refusal) — the viewer route marks it here when that happens,
 * and the thread screen reads it back into `MessageBubble`'s
 * `recipientExhausted` prop. A tiny module-level zustand store (already a
 * dependency) rather than route params or a query-cache entry: it needs to
 * survive the viewer route unmounting and be read by the thread screen still
 * mounted underneath it, and nothing here needs to persist past the session.
 */
interface RecipientExhaustedState {
  exhausted: Record<string, boolean>;
  markExhausted: (messageId: string) => void;
}

export const useRecipientExhaustedStore = create<RecipientExhaustedState>((set) => ({
  exhausted: {},
  markExhausted: (messageId) =>
    set((state) =>
      state.exhausted[messageId] ? state : { exhausted: { ...state.exhausted, [messageId]: true } }
    ),
}));
