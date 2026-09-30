/**
 * Shared React Query keys for every Me-redesign screen
 * (`docs/design/me-redesign/brief.md`). Three concurrent builds share this
 * one file by design (the parent task told each of them this exact path):
 * the private-card build (`app/src/me/card/**`, `app/me/private-card.tsx`,
 * `app/profile-editor/private-card.tsx`, `app/profile-editor/about.tsx`)
 * added the original `queryKeys.me.*` keys below; the Me root/Settings
 * build (this one) added the rest, additively — nothing the private-card
 * build already shipped was renamed or removed, so its existing imports
 * keep working unchanged. The profile editor build should import from here
 * too rather than inventing its own key strings.
 *
 * Every key is a plain `['me', '<name>']` tuple (`as const` so the tuple
 * type is exact, not widened to `string[]`) — no per-user id is included:
 * every one of these reads is already scoped to the signed-in caller
 * server-side (`me()`, owner-only edge-function routes, owner-filtered
 * PostgREST selects), so there's nothing else to key on and no risk of one
 * user's cached value leaking into another session (a fresh sign-in gets a
 * fresh `QueryClient`).
 *
 * Convention: a mutation should `invalidateQueries` the key(s) its own
 * write affects. `(tabs)/settings.tsx` (the Me root) additionally
 * refetches everything it reads on every focus
 * (`app/src/me/root/useMeData.ts`), so even a writer that forgets to
 * invalidate is caught the next time Me is focused.
 */
export const queryKeys = {
  me: {
    /** `profiles` row fields (first name, grad year, status line) — `api/profile.ts`. Kept from the original private-card build; the Me root/Settings build below reads the same three fields through its own, more granular keys (`firstName`/`gradYear`/`status`) since `api/profile.ts` exposes them as three separate reads, not one combined fetcher — use whichever shape your screen's own query function returns. */
    profile: ['me', 'profile'] as const,
    /** `listMyPhotos()` — `api/photos.ts`. */
    photos: ['me', 'photos'] as const,
    /** The caller's `user_goals` rows — `api/goals.ts`. */
    goals: ['me', 'goals'] as const,
    /** The caller's `user_tags` rows — `api/tags.ts`. */
    tags: ['me', 'tags'] as const,
    /** `profiles.status_line` — `api/profile.ts#getStatusLine`. */
    status: ['me', 'status'] as const,
    /** Private-card shares the caller owns — `api/shares.ts#listSharesForSubject('private_card', ownerId)`. */
    shares: ['me', 'shares'] as const,
    /** The caller's albums — `api/albums.ts#listMyAlbums()`. */
    albums: ['me', 'albums'] as const,
    /** The caller's own private card — `api/identityWrite.ts#getMyCard`. */
    card: ['me', 'card'] as const,
    /** The caller's own pronouns/orientation/`is_public` — `api/identity.ts` + the owner-granted `user_identity` columns. */
    about: ['me', 'about'] as const,

    // -- Me root / Settings additions (this build) --------------------------
    /** `api/me.ts#me()` — status, verification_status, campus, here_now, counts. Read by Me (identity/verified/campus short name) and Settings (account section). */
    result: ['me', 'result'] as const,
    /** `api/profile.ts#getFirstName()`. Read by Me's identity row. */
    firstName: ['me', 'first_name'] as const,
    /** `api/profile.ts#getGradYear()`. Read by Me's identity line. */
    gradYear: ['me', 'grad_year'] as const,
    /** Album count plus how many of those albums currently have at least one active share (`{ albumCount, sharedAlbumCount }`) — this build's own aggregate over `albums`/`shares` (`src/me/root/queries.ts#getAlbumsSummary`). Kept distinct from `albums` above, which is the raw `AlbumRow[]` list — same underlying tables, different shape, so a different key. */
    albumsSummary: ['me', 'albums_summary'] as const,
    /** `api/notificationPrefs.ts`. Settings-only. */
    notificationPrefs: ['me', 'notification_prefs'] as const,
    /** `api/blocks.ts#listBlockedUsers()`. Read by Settings' "blocked" row and `/me/blocked`. */
    blockedUsers: ['me', 'blocked_users'] as const,
    /** `api/presence.ts#getMyPresence()`. Settings' "who can see you" toggles seed from this (`is_visible` -> `pause my grid`'s initial value) alongside `usePresenceStore`. */
    presence: ['me', 'presence'] as const,

    // -- Profile redesign, phase 2 (migration 0015) --------------------------
    /** `api/profileFields.ts#getMyProfileFields()` — place line, usual places, prompt answers, coarse join date. */
    profileFields: ['me', 'profile_fields'] as const,
    /** `api/profileFields.ts#listActivePrompts()` — the prompt picker's question list (shared, not per-user, but only the editor reads it). */
    promptOptions: ['me', 'prompt_options'] as const,

    // -- Tags and about (migration 0018) -------------------------------------
    /** `api/about.ts#getMyAbout()` — the structured about section (major, minor, graduating, work). Me's identity line reads the major from here. Distinct from `about` above, which is pronouns/orientation. */
    aboutSection: ['me', 'about_section'] as const,
    /** `api/about.ts#listPrograms()` — the campus's majors/minors for the about editor. */
    programs: ['me', 'programs'] as const,
    /** `api/notices.ts#listUnseenNotices()` — one-time notices (the 0018 tags notice). */
    notices: ['me', 'notices'] as const,
  },
  /** `api/tags.ts#listTagCatalog()` — the interest catalog offered to the caller (campus-filtered server-side). Shared by the editor, the profile screen and the pickers. */
  tagCatalog: ['tag_catalog'] as const,
} as const;

export type QueryKeys = typeof queryKeys;
