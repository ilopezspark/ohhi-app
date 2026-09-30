import { Stack } from 'expo-router';
import { ProfileEditorDraftProvider } from '../../me/editor/ProfileEditorDraftContext';

/**
 * The `/profile-editor/*` stack (`docs/design/me-redesign/brief.md`, ruling
 * 11's route map). Presented modally over the tabs — the modal presentation
 * itself is set on this whole group from the root `<Stack.Screen
 * name="profile-editor" options={{ presentation: 'modal' }} />`
 * (`app/_layout.tsx`); this file only owns the stack *inside* that modal.
 *
 * Wraps every screen under this route in one `ProfileEditorDraftProvider` —
 * see that file's own doc comment for why the draft needs to be shared
 * state, not a fresh `useProfileEditorDraft()` per screen. `private-card.tsx`
 * and `about.tsx` (the private-card build's own routes, added here
 * concurrently) sit inside this same provider too; they simply don't read
 * from it, since neither is part of the status/goals/tags draft.
 *
 * Deliberately generic beyond that — no per-route `<Stack.Screen
 * name="..."/>` options: `index`/`photos`/`status` (this build) and
 * `private-card`/`about` (the other agent's) all want the same plain,
 * headerless push, so there's nothing to enumerate.
 *
 * The profile restructure's five public-card editors (phase 4c) are plain
 * file routes here too, pushed from the section list's `about you` rows
 * (`me/editor/identityCardDraft.ts#IDENTITY_CARD_ROUTES`): `about`
 * (identity), `background`, `lifestyle`, `around` (when i'm around) and
 * `before-you-message`. They save through `PUT /identity` on their own, not
 * through the shared draft.
 */
export default function ProfileEditorLayout() {
  return (
    <ProfileEditorDraftProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </ProfileEditorDraftProvider>
  );
}
