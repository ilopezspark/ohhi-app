# Implement: public profile fields + private card, restructured

Owner's brief, received 30 September 2026, kept verbatim below. The
reconciliation against the live schema and the owner's later rulings live in
`reconcile.md` in this folder; where the two disagree, `reconcile.md` wins.

## Context

OhHi — campus proximity app, verified 18+ students. React Native + Expo,
Supabase. Reconcile every field against the existing schema and the profile
taxonomy doc; do not invent table or column names.

This is a restructure, not an addition. Most of what was on the private card
moves to the public profile. Read section 4 (migration) before writing code.

## 1. What moves, what goes

**Private card → public profile:** pronouns · orientation · interested in ·
relationship · languages · faith · politics · communication · drinking ·
smoking · 420 · when i'm free · kids · photos & content

**Stays on the private card:** how i show i like someone · pace ·
living situation · hosting · safer sex · what i'm into · dynamics ·
hard nos · privacy

**Deleted entirely:** where i'm from · getting around · checking in ·
meeting safely · anything i should know about meeting up · looking for

**Becomes a prompt:** first meet — remove the field, add the prompts in
section 5.

`pace` and `physical pace` merge into one field, `pace`, on the private card.

## 2. Public profile — new fields

All optional. All closed enums. Multi-select unless marked single. None of
these are filterable or sortable — render only.

### card: identity

**pronouns** · he/him · she/her · they/them · he/they · she/they · he/she ·
xe/xem · ze/hir · fae/faer · it/its · any pronouns · ask me ·
+ write your own (16 chars, moderated)

**orientation** · straight · gay · lesbian · bi · pan · queer · asexual ·
demisexual · graysexual · aromantic · questioning · still working it out ·
rather not say · + write your own (24 chars, moderated)

**interested in** · men · women · nonbinary people · everyone ·
still figuring it out · rather not say

**relationship** *(single)* · single · seeing someone · in a relationship ·
open · ethically non-monogamous · polyamorous · married · separated ·
it's complicated · not looking right now · rather not say

### card: background

**languages** · english · spanish · polish · tagalog · hindi · urdu · arabic ·
mandarin · cantonese · korean · vietnamese · russian · ukrainian · gujarati ·
french · portuguese · german · italian · asl · + write your own

**faith** *(single)* · christian · catholic · protestant · orthodox · muslim ·
jewish · hindu · buddhist · sikh · spiritual not religious · agnostic ·
atheist · still figuring it out · rather not say
**faith_weight** *(single)* · central to my life · important · somewhat ·
not really · rather not say

**politics** *(single)* · left · moderate · right · libertarian · apolitical ·
not into labels · rather not say
**politics_weight** *(single)* · matters a lot to me · matters some ·
doesn't matter much

### card: lifestyle

**drinking** *(single)* · i don't drink · rarely · socially · on weekends ·
often · rather not say

**smoking** *(single)* · i don't · socially · regularly · vape only ·
trying to quit · rather not say

**420** *(single)* · i don't · sometimes · socially · regularly ·
rather not say

**kids** *(single)* · no kids · i have kids · want kids someday ·
don't want kids · not sure · rather not say

### card: when i'm around

**when i'm free** · mornings · afternoons · evenings · nights ·
weekdays only · weekends only · between classes · after work ·
it changes every week

**communication** · texts back fast · slow replier · voice notes ·
calls over texts · i go quiet when i'm busy · i'm direct ·
i'll tell you if something's wrong · i need reassurance sometimes ·
i'm bad at starting conversations

### card: before you message me

Styled like hard nos — warm border, `danger-ink` label, rendered above the
say-hi bar on the profile, not buried mid-scroll.

**photos & content** · don't send pics unasked · ask before you send
anything · don't ask me for pics · don't screenshot · don't save what i
send · nothing with my face · nothing that shows where i live

### Rendering

Card order on the public profile: about → identity → background → lifestyle →
when i'm around → before you message me. Skip any card whose fields are all
empty. Skip any row with no value; never render a placeholder or "n/a".

Rows are icon + value, hairline separated, matching the existing `the basics`
card. `faith_weight` and `politics_weight` render as the sub-line under their
parent value, not as their own rows.

## 3. Private card — what's left

Sections, groups and share rules as already built. Revised membership:

### group: getting closer  (`standard`)

**how i show i like someone** · texting a lot · making time · food ·
small gifts · acts of service · physical closeness · remembering details ·
saying it straight · being reliable

**pace** *(single)* · not looking for anything physical · slow ·
take it as it comes · following your lead · i'll say what i want ·
i move fast · ask me

**living situation** *(single)* · with family · with roommates · alone ·
with a partner · on campus · moving around right now · rather not say

**hosting** *(single)* · i can host · i can't host · sometimes ·
i'd rather go out · i'd rather meet in public first

### group: intimacy  (`gated`)

Gating unchanged: both users have exchanged at least one message each, the
sender ticks the section on this share, the recipient taps a neutral cover to
reveal. No reciprocity requirement.

**safer sex** · condoms · on prep · on birth control · other contraception ·
tested recently · happy to get tested · ask me · rather not say

**dynamics** · vanilla · dominant · submissive · switch · top · bottom ·
versatile · service top · service sub · brat · brat tamer · primal ·
primal prey · rope top · rope bottom · sadist · masochist · exhibitionist ·
voyeur · pleasure dom · strict · gentle · rough · soft ·
still figuring out what i like · would rather talk about it than pick from a list

**what i'm into** — the practice list. Grouped in the picker by the
sub-headers below; stored flat.

*sensation* · impact · spanking · flogging · paddling · caning · biting ·
scratching · hair pulling · pinching · wax · ice · temperature play ·
sensory deprivation · massage · tickling

*restraint* · bondage · rope · cuffs · restraints · blindfolds · gags ·
collars · leashes · being pinned · furniture

*power* · giving orders · taking orders · rules · protocol · discipline ·
punishment · obedience · service · worship · praise · degradation ·
humiliation · begging · edging · orgasm control · denial · chastity ·
brat taming · negotiated scenes

*roleplay* · roleplay · costumes · uniforms · strangers · rivals ·
long-distance scenarios · texting scenarios

*display* · exhibitionism · voyeurism · being watched · watching · mirrors ·
photos · filming · lingerie · leather · latex · heels

*other* · feet · pet play · wrestling · shower or bath · outdoors ·
somewhere we could get caught · aftercare is important to me ·
i want to talk it through first · nothing yet, ask me later

### group: boundaries  (`always_attached`)

**hard nos** · no pics unasked · no substances · no drinking · nothing off
campus · no meeting the first week · meet in public first · daytime only at
first · no calls · no video · i don't host · no going to yours first time ·
no picking me up first time · no smoking around me · no bringing friends ·
no impact · no marks · no restraints · no filming · no photos ·
sober only · + write your own (60 chars, moderated)

**privacy** · don't tell mutual friends · don't post about us ·
don't add me on other apps yet · don't bring this up on campus ·
i'm not out to everyone · keep this between us

## 4. Migration

- Create the public columns, backfill from `private_card_values` for the 13
  moved sections, then drop those section rows.
- `pace` and `physical pace`: if both set, keep `physical pace`'s value and
  map it onto the merged enum; if only one, take it.
- Deleted sections: drop the values. Notify affected users once on next open —
  "some of what you'd filled in has moved to your profile, and a few things
  were removed. take a look." Link to the editor.
- **A moved section's old share rows do not grant anything and are deleted.**
  Anyone who had shared pronouns privately now has them public — surface this
  clearly in the notice, and do not auto-publish a moved value without the
  user seeing the notice first. Stage moved values as `pending_review` and
  publish on acknowledgement.

## 5. Prompt bank additions

`first meet` is gone as a field. Add to the bank:

- the ideal first hang is
- we should get coffee if
- meet me at
- a good first hang for me looks like
- say hi if you also
- the move after class is

## 6. Rules

- No private card field is ever filterable, sortable or searchable.
- Public identity, background and lifestyle fields are render-only too — do
  not build filtering on faith, politics, orientation or relationship. That is
  a discrimination surface, not a feature.
- Free-text entries go through the same moderation path as status.
- `interested in` is not used for grid ordering or visibility. Everyone sees
  everyone; it's information, not a filter.

## Out of scope

Don't touch the grid, chat, tags or onboarding flow beyond the prompt bank.
