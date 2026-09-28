import { create } from 'zustand';

/**
 * Which conversation `(tabs)/chats.tsx` shows in its inline detail pane on
 * `expanded` windows (`docs/app-responsive-plan.md`). A tiny Zustand store,
 * same shape as `presence/store.ts`, rather than local `useState`: `chats.tsx`
 * doesn't remount on a fold/unfold (only re-renders), so plain state would
 * already survive that — the store instead makes the selection recoverable
 * if the screen ever does remount (navigating away to another tab and back).
 */
export interface SelectedConversationState {
  conversationId: string | null;
  select: (conversationId: string | null) => void;
}

export const useSelectedConversation = create<SelectedConversationState>((set) => ({
  conversationId: null,
  select: (conversationId) => set({ conversationId }),
}));
