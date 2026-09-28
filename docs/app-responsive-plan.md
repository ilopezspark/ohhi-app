# App responsive plan

How `app/src/**` adapts beyond the 390-wide layout grid (`docs/design/system.md`)
to foldables, tablets, and landscape phones. Window size classes follow
Android's own breakpoints, since that's what a folded/unfolded device reports
through `useWindowDimensions` — there's no separate "foldable" API, just a
window whose width changes live.

## Size classes

`src/layout/useWindowClass.ts` derives one of three classes from width alone
(height never gates the class — a landscape phone is legitimately "medium"
even though it's short):

| Class | Width | Maps to |
|---|---|---|
| `compact` | `< 600dp` | phones portrait (390 baseline), folded outer screens (~360 wide) |
| `medium` | `600–839dp` | small tablets, large phones landscape, folded-outer landscape |
| `expanded` | `>= 840dp` | Pixel Fold inner (~840), Galaxy Z Fold inner (~880, near-square), tablets |

Every hook and component reads `useWindowDimensions()` directly (or through
these hooks) rather than a one-time `Dimensions.get()` — RN re-renders any
component subscribed to `useWindowDimensions` when the window changes, which
is what makes an in-place fold/unfold (no remount, no orientation "rotation"
event) update layout live. No hook here caches a class value outside React
state/render.

## Per-screen adaptation

- **Grid** (`(tabs)/grid.tsx`, `grid/GridTile.tsx`): columns from
  `useGridColumns()` — 2 / 3 / 4 by class. `FlatList`'s `numColumns` can't
  change without a remount, so the list is keyed on the column count
  (`key={`grid-${columns}`}`). Tiles keep their 4/5 aspect ratio; width is
  `(containerWidth - gaps) / columns`, clamped to a min/max (150–220) so 4
  columns on an 840-wide inner screen don't shrink below a usable tap target
  and 2 columns on a wide medium window don't balloon. Header/count row keep
  their existing 390-rhythm paddings but the row itself spans the full width
  (no extra max-width cap — it's a rail of short text, not a reading column).

- **Profile** (`profile/[id].tsx`): compact stays the existing full-bleed
  hero, unchanged. medium/expanded switch to a two-column row — hero (tinted
  photo + name) on the left at a fixed ~360–420 width, details/CTA column on
  the right, both capped inside a centred `ContentColumn` (max ~960) so the
  layout doesn't stretch edge-to-edge on a wide window. The hero's height is
  capped (`useHeroMaxHeight`) rather than filling the window's near-square
  aspect on an unfolded Z Fold — full-bleed vertical hero photos only make
  sense in a tall/narrow compact window.

- **Chat**: `(tabs)/chats.tsx` renders the list; on `expanded` it also
  renders the currently-selected thread inline, side by side (list ~360
  wide, thread fills the rest), using a shared `ThreadView` component
  extracted from `chat/[id].tsx` so `chat/[id].tsx` (the deep link target)
  and the inline expanded view render identically. Selection is lifted to a
  small `useSelectedConversation()` store (module-level state + subscribe,
  same shape as `presence/store.ts`) so it survives a fold/unfold
  re-render — `chats.tsx` doesn't remount when the class changes, only
  re-renders, so plain `useState` would also survive, but the store makes
  the selection restorable if `chats.tsx` itself ever remounts (tab switch
  away and back). On compact/medium, `chats.tsx` pushes to `/chat/[id]` as
  today and `ThreadView` is only ever mounted once, full-screen.

- **Onboarding/settings**: `OnboardingScreen` (the one wrapper every
  `(onboarding)/*` and `(auth)/email,otp` screen already renders through)
  gets its body and footer wrapped in `ContentColumn` (cap ~520, centred).
  The 8-segment progress bar and footer buttons are children of that same
  capped row, so they size to the column, not the window, on medium/expanded.
  Settings screens that use `Header` + a scroll body get the same treatment
  where they're single-column forms (`settings/notifications.tsx`,
  `settings/account.tsx`, etc.) — wrapped at the screen level, not inside
  `Header`/`ListRow` themselves, so those primitives stay layout-agnostic.

- **Sheets** (`ui/Sheet.tsx` and its consumers: `VerifySheet`, `MessageSheet`,
  `DetailsSheet`, `ShareSheet`): on `expanded`, the sheet's `left`/`right` are
  no longer both `0` — it centres at a capped width (~480) with equal margins,
  still anchored to the bottom. `compact`/`medium` keep full-width edge-to-edge,
  matching the design.

- **Safe areas / orientation**: every screen that isn't already inside a
  `Tabs`/`Stack` header (which reserve safe area automatically) uses
  `react-native-safe-area-context`'s `useSafeAreaInsets`/`SafeAreaView` — this
  pass audits `grid.tsx`, `chats.tsx`, `chat/[id].tsx`, `profile/[id].tsx`,
  and `OnboardingScreen` (currently plain `View`/`KeyboardAvoidingView` with
  a fixed 56px `topInset` and no bottom inset) and adds insets so a
  landscape phone's shorter, notch-side-shifted safe area is respected, not
  just the portrait status bar. `app.config.ts`'s `orientation` moves from
  `portrait` to `default` and `ios.supportsTablet` is set so tablets/unfolded
  foldables aren't letterboxed into a fixed portrait frame; landscape support
  means the grid and chat layouts must not assume height >= width (hero/tile
  height caps above already cover this).

## Rule

Nothing here reads `Dimensions.get('window')` once and memoizes it outside
React. `useWindowDimensions()` (directly, or via `useWindowClass`/
`useContentWidth`/`useGridColumns`) is the only source of the current window
size, so unfolding a device — which changes the window without a remount or
an orientation-change event on some devices — re-renders every consumer with
the new class on the very next frame.
