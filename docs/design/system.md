# OhHi design system

Built from the 23 screens (390x844, `Main.html` is the 24th file but is the same
contact-sheet's "welcome" entry) in `docs/design/screens/`. This doc is the
reference; the code is `app/src/theme/tokens.ts`, `app/src/theme/index.ts` and
`app/src/ui/*`. **No screen under `app/src/app/` was restyled**, with one
exception: `(tabs)/_layout.tsx` now wires up the real tab-bar icons per the
product owner's 21 September 2026 ruling on deviation 7 (decision 52,
`docs/decisions.md`) — every other screen is still exactly as it was before
that review.

All 24 screens share one inline `<style>` block almost verbatim (`Main.html`,
`Grid.html`, `Profile.html` link a trimmed version without the
chip/sheet/bubble classes — those three have no sheet/chip UI of their own).
Where the screens disagree with each other, the token/component doc comment
says which value won and what the outlier was; nothing below is invented
except where explicitly marked "proposed."

## Palette

| Token | Value | Source |
|---|---|---|
| `paper` | `#F7F3EC` | `:root --paper` — screen/canvas background |
| `ink` | `#23211F` | `:root --ink` — primary text, dark-surface fill |
| `muted` | `#6E6960` | `:root --muted` — secondary/help text |
| `signal` | `#FF5A1F` | `:root --signal` — brand accent, primary button |
| `line` | `#E2DCD0` | `:root --line` — hairline dividers |
| `surface` | `#FFFFFF` | every card/row/input/button-secondary fill |
| `surfaceTabBar` | `#FBF8F2` | bottom tab bar fill only |
| `tint` | `#ECE6DA` | `.chip.tint`, info-panel fill |
| `dashed` | `#D8D1C3` | dashed empty-state border, toggle-off track |
| `previewCanvas` | `#EFEAE0` | **not an in-app colour** — the demo-shell desk every screen's outer `<style>` sits on for side-by-side viewing (`index.html`). The 390x844 frame itself is always `paper` inline. Kept as a token because the brief names it, but no real screen should render it. |
| `onDark` | `#F7F3EC` | text on `ink`/`signal` fills (reuses `paper`) |
| `subtle` | `#8A857C` | tertiary/meta text (timestamps, counts) |
| `faint` | `#9A958B` | inactive tab colour |
| `signalPressed` | `#D4460F` | link colour on "full" screens *and* pressed state |
| `signalPressedDark` | `#B93A0A` | `a:hover` on "full" screens only — rare |
| `success` | `#B9C6A8` | verified-student badge, verification chip |
| `danger` | `#C2382B` | **product-owner ruling (decision 51)** — a muted red distinct from `signalPressed`, for `Button`'s `destructive` variant and other danger-toned text. 4.88:1 contrast on `paper`, 5.39:1 on `surface`. Links stay on `signal`/`signalPressed`. |
| `warning` | `#C77B3B` | **proposed, not extracted, kept as-is** — no warning colour appears in any screen |
| `overlay` | `rgba(35,33,31,0.45)` | sheet backdrop dim |
| `silhouette` | `rgba(35,33,31,0.16)` | placeholder-avatar SVG fill |
| `avatarTints` | 9 hex values | curated placeholder-tile palette (grid tiles, `Main.html`, `Profile.html` hero); `src/photos/tint.ts#tintForPhoto()` now hashes onto this set (product-owner ruling, deviation 6) — see `tokens.ts` |

## Type scale

| Variant | Size/weight | Where it's used |
|---|---|---|
| `wordmark` | 32/800, ls -0.05em | "ohhi" logotype (`Grid.html`, `Grid-Empty.html`, `Main.html`) |
| `hero` | 40/800, ls -0.03em | Profile hero name (`Profile.html` "maya") |
| `headline` | 34/800, ls -0.03em, lh 1.05 | `.h1` page headlines. Per-screen overrides: 32 (`Chat-List.html`), 30 (`Grid-Verify.html` sheet), 28 (`Me-Albums.html`, `Settings.html`), 26 (`Grid-Empty.html`) — `Header`/`EmptyState` take a `titleSize`/inline override for these. |
| `titleLg` | 22/800, ls -0.02em | Sheet titles, e.g. "report maya" (`Profile-Report.html`) |
| `title` | 17/700 | Row/card/thread-header names — grid tile name, "one message to maya" (`Profile-Message.html`). 16px shows up on chat-row and `Profile-Details.html` names; 17 is the more common. |
| `bodyStrong` | 16/600 | `.btn` label (every button, every screen), the two onboarding-goal checkbox titles |
| `rowLabel` | 15/600 | Row primary label (`Settings.html`, `Me.html`, album/share-row titles), the roam-pill's "Grayslake, IL" value — more common than `bodyStrong`'s 16px for this non-button role |
| `body` | 15/400, lh 1.4 | Chat bubble text, profile status line |
| `helper` | 13/400, lh 1.4 | `.help`'s own default — secondary copy under a field or button |
| `label` | 12/600 | `.field label` |
| `caption` | 12/600 | `.chip` text — same metrics as `label` by coincidence, kept separate since components override colour per-state |
| `captionMuted` | 11/600 | Timestamps ("2m", "1h"), tag-pill labels, tab-bar label |

There is no `mono` variant: the product owner's ruling (decision 50) dropped
JetBrains Mono outright rather than keep a reserved-but-unused type-scale
entry for it. Outfit is the only typeface.

Font families: Outfit 400/500/600/800 (as given), plus 700 (used 26 times,
see deviation below). All loaded via `expo-font` + `@expo-google-fonts/outfit`
in `app/src/app/_layout.tsx`, with a splash-screen hold until they resolve.

## Spacing, radii, shadows, layout

- **Spacing** is a named lookup table (`theme/tokens.ts#spacing`), not a strict
  multiplier scale — the screens themselves use 4/6/8/10/12/14/16/18/20/24/28/32
  inconsistently. Side gutter is 16px on every "full" screen (`Profile.html`/
  `Profile-Message.html` use 12px for their edge-to-edge hero card — the one
  outlier, `layout.gutterHero`). Top inset is a consistent 56px across all 24.
- **Radii**: `pill` (999, buttons/chips/inputs/toggles), `lg` (22, cards/chips.tint/
  grid tiles — the most common non-pill radius), `xl` (34, sheets/profile hero),
  `mdAvatar`/`smAvatar` (18/14, avatars), `sm` (16, small square tiles), `circle`
  (icon/back buttons).
- **Shadows**: all six box-shadows across the 24 screens are `rgba(35,33,31,α)`
  (tinted with `ink`, never pure black) at six different (offset, blur, α)
  combinations — `xs` through `xl`, plus `sheet` (the one upward shadow, `0 -12px
  40px`). See `theme/tokens.ts#shadows` for the exact CSS each maps to.
- **Layout**: 390x844 artboard, 2-column/10px-gap grid, tab bar ~64px content
  height + 26px bottom safe-area padding.
- **Motion**: **proposed, not extracted** — none of the 24 screens declare a CSS
  `transition`, `animation`, or `@keyframes` (grepped, zero matches). Conventional
  150/200/300ms durations with a standard ease-in-out curve are provided so
  components have something to animate with; flag for owner sign-off.

## Component inventory

| Component | File | Screen pattern(s) it came from |
|---|---|---|
| `Text` | `ui/Text.tsx` | the type scale above, applied everywhere |
| `Button` | `ui/Button.tsx` | `.btn`/`.primary`/`.secondary`/`.ghost` — `Grid-Verify.html` ("verify now" / "just look around"), `Profile-Report.html` ("send report & block"), `Settings.html` ("delete my account" = ghost + danger colour, not a separate class) |
| `Chip` | `ui/Chip.tsx` | `.chip`/`.chip.on`/`.chip.tint` — grad-year picker (`Onb-Basics.html`), pronoun/orientation chips (`Onb-Identity.html`), tag chips (`Onb-Status.html`), "more about maya" field pills (`Profile-Details.html`) |
| `Input` | `ui/Input.tsx` | `.field` + `.field input`/`.field textarea` — `Onb-Email.html`, `Onb-Status.html`'s status textarea, `Profile-Report.html`'s "anything else" field |
| `Surface` / `Card` | `ui/Surface.tsx` | the generic white raised block — "here now" status card (`Me.html`), "more about me" card (`Profile-Details.html`) |
| `ListRow` | `ui/ListRow.tsx` | `.row` — `Settings.html`/`Me.html` stacked link lists, `Chat-Share.html` share-tray rows |
| `Avatar` | `ui/Avatar.tsx` | `.av` — chat-row/header avatars; wraps the existing `src/photos/TintedPlaceholder.tsx` for the no-photo case rather than duplicating it |
| `Badge` / `Dot` | `ui/Badge.tsx` | "here now" tile badge, "private" album badge, verified-student check (`Grid.html`); `Dot` = the unread/here-now indicator dot |
| `Sheet` | `ui/Sheet.tsx` | `.dim` + `.sheet` + `.handle` — `Grid-Verify.html`, `Profile-Message.html`, `Profile-Report.html`, `Chat-Share.html`. Static/presentational only — no `Modal`, no gesture wiring; the screen that uses it owns mounting/animation. |
| `Banner` / `Toast` | `ui/Banner.tsx` | `Banner` = the tinted info-panel ("a few rules" in `Me-Albums.html`, "be normal about it" in `Profile-Details.html`, "the rest lives in more about me" in `Onb-Identity.html`). `Toast` is a floating variant with no direct screen mockup, offered for ephemeral confirmations. |
| `TabBar` (`tabBarScreenOptions`, `TabBarIcon`) | `ui/TabBar.tsx` | `Grid.html`/`Chat-List.html`/`Me.html`'s shared bottom tab bar, as an Expo Router `screenOptions` object; `TabBarIcon` renders the real `ui/icons` SVGs (decision 52) |
| `Icon` (+ 16 named glyphs) | `ui/icons/Icon.tsx` | Every hand-drawn line icon ported from `docs/design/screens/*.html` via `react-native-svg` (decision 52) — `back`, `more`, `person`, `plus`, `send`, `grid`, `his`, `chat`, `camera`, `album`, `bell`, `search`, `check`, `lock`, `settings`, `pin` |
| `Header` / `BackButton` | `ui/Header.tsx` | `.back` + `.h1` row every non-tab screen opens with |
| `EmptyState` | `ui/EmptyState.tsx` | `Grid-Empty.html`'s centred icon/headline/helper/action stack |
| `Toggle` | `ui/Toggle.tsx` | The `width:44px;height:26px;border-radius:999px` pill switch — `Onb-Identity.html`'s "show these on my profile" row (off track only), `Me.html`'s "here now" status card (the one screen that shows an *on* state, `#FF5A1F`/`colors.signal`). Previously two duplicate local copies (`onboarding/components/Toggle.tsx`, `settings/components/Toggle.tsx`); promoted here as the one implementation. |

## Screen -> app route map

| Design screen | App route | Notes |
|---|---|---|
| `Main.html` (welcome) | **none** | `src/app/index.tsx` is a silent session-bootstrap spinner, not a visual welcome screen — it replaces straight to `(auth)/email` or the resolved destination. This is the clearest "design screen with no app route" case. |
| `Onb-Email.html` | `(auth)/email.tsx` | |
| `Onb-Code.html` | `(auth)/otp.tsx` | |
| `Onb-Basics.html` | `(onboarding)/name.tsx` + `(onboarding)/dob.tsx` | The design combines name, grad year *and* birthday on one screen; the app splits them into two separate steps. |
| `Onb-Goal.html` | `(onboarding)/goals.tsx` | |
| `Onb-Identity.html` | **none in onboarding** — closest is `settings/identity.tsx` | The design shows pronouns/orientation as onboarding step 4; the app's step order (README: dob -> name -> goals -> photo -> tags -> status -> finish) has no identity step at all. Identity is only ever set post-onboarding, from `settings/identity.tsx`. |
| `Onb-Photos.html` | `(onboarding)/photo.tsx` | |
| `Onb-Status.html` | `(onboarding)/status.tsx` | |
| `Onb-Location.html` | **none in onboarding** | Location permission isn't an onboarding step in the app; it's requested from the grid (`src/presence/`). |
| `Grid-Verify.html` | Grid's verification banner (`src/grid/Banner.tsx`, wired in `(tabs)/grid.tsx`) | The design is an in-app two-button bottom sheet ("verify now" / "just look around"); the app instead opens an external Persona web flow (`startAndOpenVerification`) directly from the banner's single action button — no in-app sheet with a "look around" dismiss option today. |
| `Grid.html` | `(tabs)/grid.tsx` | |
| `Grid-Empty.html` | `(tabs)/grid.tsx`'s `ListEmptyComponent` | Currently plain text ("No one's around right now"), not the illustrated empty state the design shows. |
| `Profile.html` | `profile/[id].tsx` | |
| `Profile-Message.html` | `profile/[id].tsx`'s `CtaButton`/message flow (`src/card/CtaButton.tsx`) | The design is a bottom-sheet composer; the app's current message flow doesn't render one yet (goes straight to `startConversation`). |
| `Profile-Report.html` | `settings/report/[id].tsx` | |
| `Profile-Details.html` | **none** — closest is `settings/card.tsx` (the editor, not the shared/read view) | No screen renders someone else's shared "more about me" card the way `Profile-Details.html` shows it (categorized chip groups with a "she shared this with you" header). |
| `Chat-List.html` | `(tabs)/chats.tsx` | |
| `Chat-Thread.html` | `chat/[id].tsx` | |
| `Chat-Share.html` | **none** | `src/api/shares.ts` exists (the RPC client), but no screen/sheet in `chat/[id].tsx` opens a share tray yet. |
| `Chat-Album.html` | **none** | Same gap — no album-in-bubble rendering in `chat/[id].tsx` yet. |
| `Me.html` | `(tabs)/settings.tsx` | Confusingly named: the tab *file* is `settings.tsx` but it *is* the "me" screen (pause/here-now/verification/status), per the task brief's own mapping. |
| `Me-Albums.html` | `settings/albums/index.tsx` | |
| `Settings.html` | `settings/notifications.tsx` + `settings/account.tsx` (+ others) | The design's single "settings" screen (notifications, blocked, school email, legal links, log out, delete account) is split across several route files in the app; there's no single screen matching it 1:1. |

## Proposed deviations — product-owner rulings (21 September 2026)

Conflicts between the design screens and the app's recorded
decisions/behaviour, or internal inconsistencies within the screens
themselves. Deviations 2, 4, 6 and 7 are **resolved** below (decisions 50-52,
`docs/decisions.md`); 1, 3, 5 and 8 were reviewed and kept at their applied
default — no code change beyond confirming the default holds.

1. **`Profile-Details.html` shows pronouns/orientation unconditionally.** The
   shared "more about maya" card renders "pronouns: she/her" and "i'm: bi"
   with no visible gate. `settings/identity.tsx`'s own doc comment says
   `is_public` is off by default and gates exactly this data.
   **Applied default: gate kept.** The mockup assumes `is_public: true` for
   "maya"; `is_public`'s off-by-default behaviour is not a bug and is
   unchanged.
2. **RESOLVED — JetBrains Mono is loaded but never used.** 19 of the 24
   screens link `family=JetBrains+Mono:wght@500`; zero of them apply it in
   any `font-family` declaration — verification codes, timestamps and the
   `CLC` campus code all render in Outfit.
   **Ruling (decision 50): dropped outright.** `@expo-google-fonts/jetbrains-mono`
   is uninstalled, its loading removed from `_layout.tsx`, and
   `typography.mono`/`fontFamilies.jetBrainsMono` deleted from
   `theme/tokens.ts`. Outfit is the only typeface in the app.
3. **Weight 700 is used but never loaded.** The screens' own Google Fonts
   `<link>` only requests `Outfit:wght@400;500;600;800` — no 700 — yet 26
   inline styles set `font-weight: 700` (names, sheet titles).
   **Applied default: 700 loaded.** This kit loads `Outfit_700Bold` for real
   (`fontFamilies.outfitBold`) rather than reproducing the browser
   synthesize/fallback gap — unchanged by this pass.
4. **RESOLVED — two different link/danger colours, never reconciled.**
   `Grid.html`/`Profile.html`/`index.html` use `signal` (`#FF5A1F`) as the
   resting link colour with `#D4460F` as its hover. Every "full" (chip/sheet)
   screen inverts this: `#D4460F` is the resting link colour, `#B93A0A` its
   hover. `#D4460F` was *also* the only danger colour (`Settings.html`'s
   "delete my account").
   **Ruling (decision 51): a real danger colour.** `colors.danger` is now
   `#C2382B`, a muted red distinct from `colors.signalPressed` (`#D4460F`) —
   4.88:1 contrast on `paper`, 5.39:1 on `surface`, both clearing WCAG AA's
   4.5:1 minimum for normal text. `Button`'s `destructive` variant and other
   danger-toned text use it. Links stay on `signal`/`signalPressed`,
   unchanged.
5. **No warning colour exists anywhere in the 24 screens.** The app's
   existing `src/grid/Banner.tsx` has a `tone="warning"` (the paused banner).
   **Applied default: proposed value kept.** `colors.warning` (`#C77B3B`)
   stays as originally proposed, not extracted — unchanged by this pass.
6. **RESOLVED — the avatar/tile tint palette is curated in the design,
   hashed in code.** The screens use a fixed set of 9 tones
   (`colors.avatarTints`); `src/photos/tint.ts#tintForPhoto()` instead hashed
   the user id to an arbitrary HSL hue, so tiles never matched the design.
   **Ruling: constrain to the curated set.** `tintForPhoto()` now hashes the
   user id + photo position onto an index into `colors.avatarTints`, same
   determinism as before. `user_photos.tint` values already stored on the
   hosted Sayohhi project were computed by the old (arbitrary-hue) function
   and are **not backfilled** — this column is a display fallback, not a
   source of truth, so old rows just keep their old hue until the next
   write.
7. **RESOLVED — no icon library was installed.** The screens' icons are
   hand-drawn SVG line icons; `ui/TabBar.tsx`'s `TabBarIcon` previously
   approximated their silhouettes with plain `View`s.
   **Ruling (decision 52): `react-native-svg` installed.** Every icon used
   across the 24 screens was extracted, de-duplicated, and ported as typed
   components under `app/src/ui/icons/` (`<Icon name="..." />` plus named
   exports — `BackIcon`, `MoreIcon`, `PersonIcon`, `PlusIcon`, `SendIcon`,
   `GridIcon`, `HisIcon`, `ChatIcon`, `CameraIcon`, `AlbumIcon`, `BellIcon`,
   `SearchIcon`, `CheckIcon`, `LockIcon`, `SettingsIcon`, `PinIcon`),
   preserving each icon's stroke width/caps/joins/viewBox. `TabBarIcon` and
   `(tabs)/_layout.tsx` (the one screen-layout file this pass touched) now
   render the real icons. Two things named in the brief don't exist as
   distinct icons in the 24 screens and weren't invented: the "here-now dot"
   is a plain CSS dot, not an SVG (already `ui/Badge.tsx`'s `Dot`), and no
   "close"/X icon appears anywhere (sheets dismiss via a backdrop tap, never
   an explicit close button).
8. **No dark theme.** None of the 24 screens declare
   `prefers-color-scheme` or a dark variant; `theme/index.ts`'s `theme` is
   light-only.
   **Applied default: light only.** `ThemeProvider`/`useTheme()` still exist
   so a second theme can be added later without call sites changing —
   unchanged by this pass.

## Deferred to product-owner review

The deviations above are now settled per the 21 September 2026 rulings
(decisions 50-52, `docs/decisions.md`). Per the task brief for this pass: no
screen under `app/src/app/` was restyled, except `(tabs)/_layout.tsx` for
decision 52's real tab-bar icons. The rest of the tokens and component kit
are ready for a future pass to swap the app's screens over to them.
