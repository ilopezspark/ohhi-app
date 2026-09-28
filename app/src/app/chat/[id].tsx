import { router, useLocalSearchParams } from 'expo-router';
import { ThreadView } from '../../chat/ThreadView';

/**
 * The deep-link/full-screen route for a thread. All behaviour lives in
 * `src/chat/ThreadView.tsx`, shared verbatim with `(tabs)/chats.tsx`'s
 * inline detail pane on `expanded` windows (`docs/app-responsive-plan.md`)
 * — this file only wires route params to props and `router.back()` to
 * `onBack`, so a link straight into `/chat/[id]` (from the profile "message"
 * CTA, a push notification, etc.) keeps working unchanged regardless of
 * window size.
 */
export default function ChatThreadScreen() {
  const { id: conversationId, draft: initialDraft } = useLocalSearchParams<{ id: string; draft?: string }>();

  return <ThreadView conversationId={conversationId} initialDraft={initialDraft} onBack={() => router.back()} />;
}
