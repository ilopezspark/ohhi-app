# The Me section, redesigned: brief and rulings

Source: the product owner's brief and the "OhHi — Me, redesigned" canvas, 28 September 2026.
The eight artboards are in this folder as PNGs (`01-me.png` … `08-edit-private-card.png`) and as
`me-redesign.pdf`. Where this file's **Rulings** section and the brief disagree, the rulings win:
they are the owner's answers after the brief was reconciled against the schema and the recorded
decisions.

## Rulings (28 September 2026)

1. **Private card contents.** The card holds **into, safer sex, kinks, hard nos** — four groups,
   as today. Pronouns and orientation are **not** in the card. The artboards draw pronouns and
   "i'm" inside the card; do not build that.
2. **Pronouns and orientation are public profile fields behind one opt-in switch**, off by
   default ("show on my profile", `user_identity.is_public`). This is unchanged from decisions
   16, 20 and 33. They are edited in the profile editor under their own section (`about you`),
   not under the private card.
3. **Kinks stays.** It is not drawn on the artboards; render it in the same chip-card style,
   between safer sex and hard nos.
4. **Hard nos accept typed entries** ("+ add your own"): hard nos only, at most 40 characters
   each, at most 8 items in the group. Every other group stays a fixed list.
5. **Hard nos always render last**, in the card and in the editor. The editor artboard's caption
   "always shown first" is wrong; use "always shown last".
6. **No "single" chip.** The card artboard shows one; the voice rules ban the word and the editor
   does not offer it.
7. **Here for.** Five chips, mapped to stored values: `friends` → "friends", `study` → "study
   buddies", `dates` → "something more", `gym` → "a gym partner" (new value, added by migration
   0011), `whatever` → "still figuring it out". The stored value `group` is retired: never offered;
   a user who already has it keeps it until they next save, and it displays as "a group to hang
   with" wherever goals are shown.
8. **Danger colour.** Decision 51 stands: destructive actions (delete my account, remove photo,
   block) use the existing `colors.danger` red. The brief's "no red" does not apply to destructive
   actions. The brief's `danger-ink` / `danger-bg` pair is added to the theme under the names
   `boundaryInk` / `boundaryBg` and used ONLY for the hard-nos chips and label.
9. **No monospace font.** Decision 50 stands; JetBrains Mono is not loaded. Ignore the brief's
   note reserving it for grid tiles.
10. **Photo reorder** goes through a new RPC from migration 0011 (contract below). The client
    never writes `user_photos.position` directly.
11. **Navigation.** The app uses Expo Router, not a hand-built native stack. Route map:
    - Me root: `(tabs)/settings.tsx` stays the route file (other screens link to it); tab title `me`.
    - `/me/private-card`, `/me/settings`; albums keep their existing routes under `/settings/albums`.
    - Profile editor, presented modally: `/profile-editor` (Edit | Preview, `?tab=preview` opens on
      Preview), `/profile-editor/photos`, `/profile-editor/status`, `/profile-editor/about`,
      `/profile-editor/private-card`.
    - `/quick-status`, a standalone modal from the Me status row.
    - The old `/settings/menu`, `/settings/profile-edit`, `/settings/identity`, `/settings/card`
      routes are replaced; keep redirects so existing links do not break. `/settings/block/[id]`,
      `/settings/report/[id]`, `/settings/notifications`, `/settings/account` and the albums routes
      keep working.
12. **Legal and help links** ("what we do with your id", "how to not get banned", privacy, terms)
    have no URLs yet. Build the rows; each opens a placeholder screen saying the page is coming,
    behind one constant map so real URLs drop in later.
13. **"report someone"** in Settings opens a short explainer: reports are filed from a person's
    profile or a chat, via the ⋯ menu. No person picker.
14. **"my campus"** shows campus name and city; the chevron opens a read-only screen. No campus
    switching exists.

## Contract: photo reorder (migration 0011)

`public.set_my_photo_order(p_photo_ids uuid[]) returns setof public.user_photos` — the caller's
own photo ids in the desired order; index 0 becomes the grid tile. It must list every photo the
caller has, exactly once. Refusals use the generic `'not allowed'` / 42501. A photo whose
`moderation_state` is `removed` cannot be first. Moving an approved photo to first keeps the user
visible; moving a `pending` one to first takes them off the grid until it is approved (the app
warns before doing it). Storage paths do not change when order changes, so **a photo's storage
path is not derived from its position** after 0011: new uploads use `{user_id}/{photo_id}.jpg`;
existing `{user_id}/{0-2}.jpg` paths stay valid.

## Completion math

One pure function, used by the Me bar and the editor's per-section weights:

| Item | Weight |
|---|---|
| photo 1 | 30 |
| photo 2 | 20 |
| photo 3 | 20 |
| status | 10 |
| here for | 10 |
| tags | 10 |

Pronouns, orientation and the private card carry no weight: they are optional and private by
default, and nobody should feel nudged into filling them in. The editor's `+N%` label shows the
weight of the next unfilled item in that section.

---

# The brief, as written

## Context

OhHi is a campus proximity app for verified college students — a grid of who's around, no
swiping, no algorithm, nothing to buy, .edu-gated. React Native + Expo, Supabase (Postgres + RLS
+ Auth + Storage + Realtime).

You are replacing the existing Me tab. The current one is a settings drawer with a profile bolted
on. The redesign follows the conventions of Tinder and Hinge: **Me is a launchpad, editing is a
modal sheet with Edit/Preview tabs, and everything administrative lives in Settings.**

Match the canvas's layout, spacing and hierarchy. Reconcile all data fields against the existing
schema and technical brief — do not invent table or column names. If a field the design needs
doesn't exist yet, say so rather than guessing.

## Scope — 8 screens

```
MeTab
├─ Me                  root
├─ PrivateCard         push
├─ Albums              push
└─ Settings            push

ProfileEditor (modal, presented over the tab)
├─ Editor              root — Edit | Preview tab switch
├─ EditPhotos          push
├─ EditStatus          push
└─ EditPrivateCard     push

QuickStatus            standalone modal, from the Me status row
```

`EditStatus` and `QuickStatus` render the same component with different presentation and dismiss
targets.

## Design tokens

Add these to the theme if they aren't there. Never hardcode a hex in a screen.

```
paper        #F7F3EC   paper-raised #FFFFFF   paper-tint #ECE6DA
line         #E2DCD0   line-soft    #EFE9DE
ink          #23211F   ink-muted    #6E6960   ink-soft   #8A857C
ink-faint    #A39D93   ink-disabled #B0AAA0
signal       #FF5A1F   signal-deep  #D4460F   sage       #B9C6A8
danger-ink   #8C3A10   danger-bg    #F7E3D8      (see ruling 8: named boundaryInk / boundaryBg)
tints: peach #E8C9B4 · sky #C9D6E3 · sage #D5E0CB · sand #EBD5B0

radius: sm 8 · tile 20 · card 22 · hero 34 · pill 999
space:  4 8 12 16 20 24 32 · top 56
shadow: float 0 2px 8px rgba(35,33,31,.08)
        card  0 6px 18px rgba(35,33,31,.08)
        hero  0 16px 40px rgba(35,33,31,.14)

type: Outfit (400/500/600/700/800)
display 30/800/-0.03em · title 17/700 · body 15/500 · label 13/600
micro 12/500 · section-label 11/700/0.1em uppercase
```

No dark mode. No gradients except the scrim over profile photos. No pink. No hearts, flames or
sparkles.

## Voice rules (enforce in every string)

- All UI copy is lowercase, full sentences, dry — not peppy.
- **No exclamation points. No emoji**, except the 👋 on the say-hi button.
- Never use: match, swipe, like, date, single, catch, perfect, connection, journey.
- Use: hi, hi back, around, here now, nearby, your grid.

## Screens

### Me
Header: `me` (display) left, gear icon button right → Settings.

Identity row: 76×95 rounded tile (radius 20) showing photo 1, then name (display), sage verified
check, `CLC · cs '27` (campus short name, the user's major tag, grad year), and a dark pill button
`edit profile` with a pencil icon → opens ProfileEditor.

Completion: 6px track, signal fill, percentage label. One line of copy beneath naming the single
highest-value missing item.

`see how you look on the grid` — full-width white pill → ProfileEditor opened on the Preview tab.

Section `status`: white card showing the current status with a pencil accessory → QuickStatus.
Empty state: `add a status` in ink-soft.

Section `only for people you choose`: one white container, two hairline-separated rows —
**private card** (`shared with N people`) and **albums** (`N albums · N shared`), each with a
chevron.

Tab bar at the bottom, `me` active.

### ProfileEditor — Edit tab
Header: `cancel` / name / `done`. Below it a 2-up underlined tab switch: `edit` | `preview`.
Scrolling content.

Each section has a label row: optional signal dot when incomplete, uppercase section label, and a
`+N%` completion weight on the right in signal-deep.

- **photos** — 3-up grid, 4:5, radius 18. Filled tiles carry a white pencil badge top-right and
  photo 1 carries an `on the grid` pill. The empty slot is a dashed field with a floating signal
  `+` badge. Caption: `tap to edit, drag to reorder. the first one is your tile.` Tapping any tile
  pushes EditPhotos.
- **status** — white card with the text and a chevron → EditStatus.
- **here for** — white card of chips, multi-select. Selected chips are ink fill / paper text;
  unselected are paper-tint / ink-muted.
- **tags** — same chip card, max 3, header shows `N of 3`.
- **about you** (ruling 2) — row → `/profile-editor/about`: pronouns, i'm, and the
  `show on my profile` switch. Subtitle `hidden` or `shown on your profile`.
- **private card** — row → EditPrivateCard, subtitle `N of 4 filled in`, right-hand note
  `never on the grid`.

`cancel` discards; `done` commits. Warn on dismiss if dirty.

### ProfileEditor — Preview tab
Same header and tab switch. Renders the real profile card at full height using the **same
component the grid and profile screens use** — not a copy. Say-hi and message buttons render at
40% opacity and are non-interactive. Caption above: `this is you on the grid right now.` Caption
below: `their buttons are greyed out. you can't say hi to yourself.`

### EditPhotos
Header: back / `photos` / `done`. 2-column 4:5 grid. Long-press to drag-reorder (reordering photo
1 changes the grid tile — reflect immediately). Pencil badge opens an action sheet: replace, make
first, remove. Empty slots dashed with a signal `+`. A fourth, inert tile reads
`3 photos max. keeps everyone's grid honest.` A rules card at the bottom, `what gets through
review`: `just you, face visible in the first one` · `taken by you, not pulled off instagram` ·
`no group shots, no nudity, no filters that hide your face`.

### EditStatus / QuickStatus
Header: `cancel` / `status` / `save`. Intro line: `one line about what you're doing right now. it
sits on your tile and it's usually the reason someone says hi.` Autofocused multiline field, 140
char max, live counter bottom-right inside the card, `clear` action. Below, `or start from one of
these`: four tappable suggestion pills that replace the field contents (`at the library till 10,
come pretend to study` · `free between classes, anyone want coffee` · `new here, don't know anyone
yet` · `gym at 6 if anyone wants to come`). Footer note: `change it as often as you want. no one
gets a notification when you do.`

### PrivateCard
Header: back / `private card` / `edit`. A lock explainer strip: `never on the grid, never on your
public card. you send it inside a chat, to one person, and you can take it back.` Then
`how it arrives in a chat`: the card rendered exactly as the recipient sees it in chat — titled
`more about <name>` with a `private` label, grouped chip rows for into, safer sex, kinks and hard
nos (ruling 1; hard nos use boundaryBg / boundaryInk and always render last). Then a `shared with`
list: avatar, name, when it was sent, and a `take back` button per person that revokes access
immediately.

### EditPrivateCard
Header: `cancel` / `more about me` / `done`. Explainer strip: `filling this in doesn't show it to
anyone. you still choose who gets it, one chat at a time.` Then four chip-card groups matching
PrivateCard's fields. Hard nos card gets a warm border and a `+ add your own` chip. Footer:
`sharing this is never automatic, and it never happens before you've both said hi.`

### Settings
Header: back / `settings`. Grouped white containers with hairline rows:

- **account** — my campus, verification (sage `verified` badge), school email
- **who can see you** — `here now` toggle (subtitle: `turns off by itself after 2 hours`),
  `pause my grid` toggle (subtitle: `hides you from everyone. your chats stay put.`)
- **notifications** — `hi's and chats`, `someone new around` (subtitle: `one an hour at most,
  never at night`)
- **safety** — blocked (count), report someone
- **the boring but important stuff** — what we do with your id (`plain english, 2 minutes`), how
  to not get banned, privacy, terms
- `log out`, then `delete my account` in the danger colour
- Footer: version, campus, and `we never store where you are, only how far apart you are.`

Schema mapping: `hi's and chats` writes `notification_prefs.hi_received`, `hi_back` and
`new_message` together; `someone new around` writes `someone_new_nearby`. `here now` calls
`set_here_now`, which sets a two-hour expiry server-side. `pause my grid` calls `pause_grid`.
`school email` reads `users_private.school_email`.

## Shared components to build

`ProfileTile` (one component, size variants: grid / thumbnail / hero — reused by the grid, the
editor and Preview), `SectionLabel`, `Chip` + `ChipGroup`, `SettingsRow` (chevron | toggle | badge
accessories), `CompletionBar`, `RowCard` (white container with hairline-separated children).

## Rules

- Every tappable target ≥ 44pt.
- Real accessibility roles and labels on every icon-only control.
- Optimistic writes with rollback on failure; never block the UI on a round trip for a toggle.
- `pause my grid` and `here now` must write server-side and be enforced by RLS, not just hidden
  client-side.
- Photo uploads go through the existing moderation queue. Do not bypass it.
- `take back` on a private card share must revoke server-side and be irreversible from the
  recipient's side on next fetch.

## Out of scope

Do not build: chat, hi's, onboarding, verification flow, or albums internals — link to the
existing screens. The grid and profile screens change only as far as adopting the shared
`ProfileTile`. Do not add any monetization surface, promo card, boost, or upsell. Do not add
ranking, scoring, or recommendations anywhere.

## Done means

All screens navigable end to end, completion math consistent between Me and the editor, Preview
rendering through the shared tile component, editor changes persisting and reflecting on Me
without a manual refresh, and no string violating the voice rules.
