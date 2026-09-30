import type { Audience, CardGroup, CardSection, IdentityCard, IdentityField } from '../profile/identityFields';

/**
 * Display names for the restructured profile: the public cards and their
 * fields, the private-card sections and groups, and the audiences. Owner
 * ruling 3 (docs/design/profile-restructure/reconcile.md): field names and
 * option labels are the owner's content, used exactly as the brief writes
 * them and exempt from the voice rules ("how i show i like someone"). Like
 * the option lists in `settings/vocab.ts`, they are data, which is why they
 * live here and not in a voice-linted folder; `me/card/fieldLabels.ts`
 * re-exports them for the screens.
 *
 * Two names are not in the brief and are the app's own wording: the weight
 * sub-fields (`faith_weight`, `politics_weight`), which the brief names only
 * by key, and the audience labels, which follow ruling 1's wording.
 */

/** Public card titles, keyed by card (brief §2 "card: …"). */
export const IDENTITY_CARD_LABELS: Record<IdentityCard, string> = {
  identity: 'identity',
  background: 'background',
  lifestyle: 'lifestyle',
  around: "when i'm around",
  before_you_message: 'before you message me',
};

/** Public field names, keyed by payload key (brief §2). */
export const IDENTITY_FIELD_LABELS: Record<IdentityField, string> = {
  pronouns: 'pronouns',
  orientation: 'orientation',
  interested_in: 'interested in',
  relationship: 'relationship',
  languages: 'languages',
  faith: 'faith',
  faith_weight: 'how much it matters',
  politics: 'politics',
  politics_weight: 'how much it matters',
  drinking: 'drinking',
  smoking: 'smoking',
  four_twenty: '420',
  kids: 'kids',
  when_free: "when i'm free",
  communication: 'communication',
  photos_content: 'photos & content',
};

/** Private-card section names, keyed by payload key (brief §3). */
export const CARD_SECTION_LABELS: Record<CardSection, string> = {
  shows_interest: 'how i show i like someone',
  pace: 'pace',
  living_situation: 'living situation',
  hosting: 'hosting',
  safer_sex: 'safer sex',
  dynamics: 'dynamics',
  practices: "what i'm into",
  hard_nos: 'hard nos',
  privacy: 'privacy',
};

/** Private-card group names (brief §3 "group: …"). */
export const CARD_GROUP_LABELS: Record<CardGroup, string> = {
  standard: 'getting closer',
  gated: 'intimacy',
  always_attached: 'boundaries',
};

/** "who sees this" choices (ruling 1). */
export const AUDIENCE_LABELS: Record<Audience, string> = {
  everyone: 'everyone',
  after_hi: 'after a hi is answered',
  only_me: 'only me',
};
