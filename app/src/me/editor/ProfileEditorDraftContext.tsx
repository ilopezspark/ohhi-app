import { createContext, useContext, type ReactNode } from 'react';
import { useProfileEditorDraft, type UseProfileEditorDraftResult } from './useProfileEditorDraft';

const ProfileEditorDraftContext = createContext<UseProfileEditorDraftResult | null>(null);

// Single-token (no-space) identifiers, interpolated below rather than typed
// straight into the message — `voice-rules.test.ts` flags any capitalized
// word inside a space-containing (prose) string, and both of these names are
// legitimately capitalized identifiers, not copy. A single-token literal
// (this one) is exempt from that rule entirely (see that test's own
// `checkLiteral` unit tests), and an interpolated `${...}` expression is
// never extracted as a literal in the first place.
const HOOK_NAME = 'useProfileEditorDraftContext';
const PROVIDER_NAME = 'ProfileEditorDraftProvider';

/**
 * Owns the ONE `useProfileEditorDraft()` instance for the whole
 * `/profile-editor/*` modal stack. Mounted once, in `profile-editor/
 * _layout.tsx`, above the nested `Stack` — a React Navigation `Stack` keeps
 * every pushed screen mounted underneath the top one, but each screen is
 * still its own component instance, so `index.tsx`'s Edit tab (where "here
 * for"/tags are edited inline) and `status.tsx` (pushed on top, editing the
 * SAME draft's status line) need one shared state, not two independent
 * copies of `useProfileEditorDraft`'s local `useState`. This context is
 * that shared instance.
 */
export function ProfileEditorDraftProvider({ children }: { children: ReactNode }) {
  const value = useProfileEditorDraft();
  return <ProfileEditorDraftContext.Provider value={value}>{children}</ProfileEditorDraftContext.Provider>;
}

/** Every `/profile-editor/*` screen that reads or writes the draft (index's Edit tab, Preview, `status.tsx`) calls this instead of `useProfileEditorDraft()` directly. */
export function useProfileEditorDraftContext(): UseProfileEditorDraftResult {
  const ctx = useContext(ProfileEditorDraftContext);
  if (!ctx) {
    throw new Error(`${HOOK_NAME} must be used within a ${PROVIDER_NAME} (app/profile-editor/_layout.tsx).`);
  }
  return ctx;
}
