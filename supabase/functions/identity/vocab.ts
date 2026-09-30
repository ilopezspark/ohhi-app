// Payload v2 vocabularies, caps and groupings for the `identity` function.
// Source: docs/design/profile-restructure/brief.md §2 (public profile) and §3
// (private card), verbatim, with the owner rulings at the bottom of
// docs/design/profile-restructure/reconcile.md:
//
//   ruling 3  labels are the owner's content, exempt from the voice rules, and
//             stored exactly as written ("single", "how i show i like someone",
//             "still figuring out what i like", ...). Stored values ARE the
//             lowercase display labels; there are no slugs.
//   ruling 4  photos & content keeps all seven requests.
//   D11       "toys" joins the practice list under *other*; the dated
//             `tested <mon> '<yy>` safer-sex chip is retired (mapped to
//             "tested recently", see mapping.ts).
//
// This module is PURE DATA: no imports, no Deno APIs, one literal per export,
// so the app can either import it or keep a synced copy checked by a
// source-reading test (decision 48; `app/src/settings/vocab.ts` and
// `editors-vocab.test.ts` today read validate.ts the same way).
//
// Every option list is closed. Only the fields marked "write your own" in the
// brief also accept typed entries (pronouns, orientation, languages, hard nos);
// typed entries go through the 0018 word filter on write (router.ts).

// =============================================================================
// Audiences (ruling 1): who sees each public card
// =============================================================================

/** `public.profile_audience` (migration 0023), in the editor's order. */
export const AUDIENCES = ["everyone", "after_hi", "only_me"] as const;

/** A card that has never had its audience set shows to everyone (ruling 1). */
export const DEFAULT_AUDIENCE = "everyone";

/**
 * The public cards that carry an audience, in render order. "before you
 * message me" has none: it is always shown to everyone once filled (ruling 1).
 */
export const AUDIENCE_CARDS = ["identity", "background", "lifestyle", "around"] as const;

// =============================================================================
// Shared caps
// =============================================================================

/** Every chip, fixed or typed, is at most 60 characters. */
export const CHIP_MAX_LENGTH = 60;

// =============================================================================
// Public profile, card: identity
// =============================================================================

/** pronouns (multi) + write your own. */
export const PRONOUN_OPTIONS = [
  "he/him",
  "she/her",
  "they/them",
  "he/they",
  "she/they",
  "he/she",
  "xe/xem",
  "ze/hir",
  "fae/faer",
  "it/its",
  "any pronouns",
  "ask me",
] as const;

/** A typed pronoun is at most 16 characters (brief §2). */
export const PRONOUN_MAX_LENGTH = 16;
/** At most one typed pronoun. */
export const PRONOUN_MAX_TYPED = 1;
/** At most three pronoun entries in total, fixed and typed together. */
export const PRONOUN_MAX_ITEMS = 3;

/** orientation (multi) + write your own. */
export const ORIENTATION_CHIPS = [
  "straight",
  "gay",
  "lesbian",
  "bi",
  "pan",
  "queer",
  "asexual",
  "demisexual",
  "graysexual",
  "aromantic",
  "questioning",
  "still working it out",
  "rather not say",
] as const;

/** A typed orientation is at most 24 characters. */
export const ORIENTATION_CHIP_MAX_LENGTH = 24;
/** At most one typed orientation. */
export const ORIENTATION_MAX_TYPED = 1;
/** At most three orientation entries in total (decision 14, unchanged). */
export const ORIENTATION_MAX_ITEMS = 3;

/** interested in (multi). Render-only; never used for ordering (brief §6). */
export const INTERESTED_IN_OPTIONS = [
  "men",
  "women",
  "nonbinary people",
  "everyone",
  "still figuring it out",
  "rather not say",
] as const;

/** relationship (single). */
export const RELATIONSHIP_OPTIONS = [
  "single",
  "seeing someone",
  "in a relationship",
  "open",
  "ethically non-monogamous",
  "polyamorous",
  "married",
  "separated",
  "it's complicated",
  "not looking right now",
  "rather not say",
] as const;

// =============================================================================
// Public profile, card: background
// =============================================================================

/** languages (multi) + write your own. */
export const LANGUAGE_OPTIONS = [
  "english",
  "spanish",
  "polish",
  "tagalog",
  "hindi",
  "urdu",
  "arabic",
  "mandarin",
  "cantonese",
  "korean",
  "vietnamese",
  "russian",
  "ukrainian",
  "gujarati",
  "french",
  "portuguese",
  "german",
  "italian",
  "asl",
] as const;

/** A typed language is at most 24 characters. */
export const LANGUAGE_MAX_LENGTH = 24;
/** At most three typed languages. */
export const LANGUAGE_MAX_TYPED = 3;
/** At most eight languages in total. */
export const LANGUAGE_MAX_ITEMS = 8;

/** faith (single). */
export const FAITH_OPTIONS = [
  "christian",
  "catholic",
  "protestant",
  "orthodox",
  "muslim",
  "jewish",
  "hindu",
  "buddhist",
  "sikh",
  "spiritual not religious",
  "agnostic",
  "atheist",
  "still figuring it out",
  "rather not say",
] as const;

/** faith_weight (single). Only valid while `faith` is set. */
export const FAITH_WEIGHT_OPTIONS = [
  "central to my life",
  "important",
  "somewhat",
  "not really",
  "rather not say",
] as const;

/** politics (single). */
export const POLITICS_OPTIONS = [
  "left",
  "moderate",
  "right",
  "libertarian",
  "apolitical",
  "not into labels",
  "rather not say",
] as const;

/** politics_weight (single). Only valid while `politics` is set. */
export const POLITICS_WEIGHT_OPTIONS = [
  "matters a lot to me",
  "matters some",
  "doesn't matter much",
] as const;

// =============================================================================
// Public profile, card: lifestyle
// =============================================================================

/** drinking (single). */
export const DRINKING_OPTIONS = [
  "i don't drink",
  "rarely",
  "socially",
  "on weekends",
  "often",
  "rather not say",
] as const;

/** smoking (single). */
export const SMOKING_OPTIONS = [
  "i don't",
  "socially",
  "regularly",
  "vape only",
  "trying to quit",
  "rather not say",
] as const;

/** 420 (single). Stored under the key `four_twenty`. */
export const FOUR_TWENTY_OPTIONS = [
  "i don't",
  "sometimes",
  "socially",
  "regularly",
  "rather not say",
] as const;

/** kids (single). */
export const KIDS_OPTIONS = [
  "no kids",
  "i have kids",
  "want kids someday",
  "don't want kids",
  "not sure",
  "rather not say",
] as const;

// =============================================================================
// Public profile, card: when i'm around
// =============================================================================

/** when i'm free (multi). */
export const WHEN_FREE_OPTIONS = [
  "mornings",
  "afternoons",
  "evenings",
  "nights",
  "weekdays only",
  "weekends only",
  "between classes",
  "after work",
  "it changes every week",
] as const;

/** communication (multi). */
export const COMMUNICATION_OPTIONS = [
  "texts back fast",
  "slow replier",
  "voice notes",
  "calls over texts",
  "i go quiet when i'm busy",
  "i'm direct",
  "i'll tell you if something's wrong",
  "i need reassurance sometimes",
  "i'm bad at starting conversations",
] as const;

/** At most five communication chips. */
export const COMMUNICATION_MAX_ITEMS = 5;

// =============================================================================
// Public profile, card: before you message me (always everyone once filled)
// =============================================================================

/** photos & content (multi). Requests, not controls (ruling 4). */
export const PHOTOS_CONTENT_OPTIONS = [
  "don't send pics unasked",
  "ask before you send anything",
  "don't ask me for pics",
  "don't screenshot",
  "don't save what i send",
  "nothing with my face",
  "nothing that shows where i live",
] as const;

/** All seven may be chosen. */
export const PHOTOS_CONTENT_MAX_ITEMS = 7;

// =============================================================================
// Private card, group: getting closer (`standard`)
// =============================================================================

/** how i show i like someone (multi). Stored under `shows_interest`. */
export const SHOWS_INTEREST_OPTIONS = [
  "texting a lot",
  "making time",
  "food",
  "small gifts",
  "acts of service",
  "physical closeness",
  "remembering details",
  "saying it straight",
  "being reliable",
] as const;

/** pace (single). */
export const PACE_OPTIONS = [
  "not looking for anything physical",
  "slow",
  "take it as it comes",
  "following your lead",
  "i'll say what i want",
  "i move fast",
  "ask me",
] as const;

/** living situation (single). */
export const LIVING_SITUATION_OPTIONS = [
  "with family",
  "with roommates",
  "alone",
  "with a partner",
  "on campus",
  "moving around right now",
  "rather not say",
] as const;

/** hosting (single). */
export const HOSTING_OPTIONS = [
  "i can host",
  "i can't host",
  "sometimes",
  "i'd rather go out",
  "i'd rather meet in public first",
] as const;

// =============================================================================
// Private card, group: intimacy (`gated`)
// =============================================================================

/** safer sex (multi). The dated `tested <mon> '<yy>` chip is retired (D11). */
export const SAFER_SEX_OPTIONS = [
  "condoms",
  "on prep",
  "on birth control",
  "other contraception",
  "tested recently",
  "happy to get tested",
  "ask me",
  "rather not say",
] as const;

/** dynamics (multi, uncapped within the list). */
export const DYNAMICS_OPTIONS = [
  "vanilla",
  "dominant",
  "submissive",
  "switch",
  "top",
  "bottom",
  "versatile",
  "service top",
  "service sub",
  "brat",
  "brat tamer",
  "primal",
  "primal prey",
  "rope top",
  "rope bottom",
  "sadist",
  "masochist",
  "exhibitionist",
  "voyeur",
  "pleasure dom",
  "strict",
  "gentle",
  "rough",
  "soft",
  "still figuring out what i like",
  "would rather talk about it than pick from a list",
] as const;

/** The practice picker's sub-headers, in order. Storage is flat (`practices`). */
export const PRACTICE_GROUP_ORDER = [
  "sensation",
  "restraint",
  "power",
  "roleplay",
  "display",
  "other",
] as const;

/**
 * what i'm into (multi, uncapped within the list). Stored flat under
 * `practices`; this grouping is for the picker only. "toys" is D11's addition.
 */
export const PRACTICE_GROUPS = {
  sensation: [
    "impact",
    "spanking",
    "flogging",
    "paddling",
    "caning",
    "biting",
    "scratching",
    "hair pulling",
    "pinching",
    "wax",
    "ice",
    "temperature play",
    "sensory deprivation",
    "massage",
    "tickling",
  ],
  restraint: [
    "bondage",
    "rope",
    "cuffs",
    "restraints",
    "blindfolds",
    "gags",
    "collars",
    "leashes",
    "being pinned",
    "furniture",
  ],
  power: [
    "giving orders",
    "taking orders",
    "rules",
    "protocol",
    "discipline",
    "punishment",
    "obedience",
    "service",
    "worship",
    "praise",
    "degradation",
    "humiliation",
    "begging",
    "edging",
    "orgasm control",
    "denial",
    "chastity",
    "brat taming",
    "negotiated scenes",
  ],
  roleplay: [
    "roleplay",
    "costumes",
    "uniforms",
    "strangers",
    "rivals",
    "long-distance scenarios",
    "texting scenarios",
  ],
  display: [
    "exhibitionism",
    "voyeurism",
    "being watched",
    "watching",
    "mirrors",
    "photos",
    "filming",
    "lingerie",
    "leather",
    "latex",
    "heels",
  ],
  other: [
    "feet",
    "pet play",
    "wrestling",
    "shower or bath",
    "outdoors",
    "somewhere we could get caught",
    "toys",
    "aftercare is important to me",
    "i want to talk it through first",
    "nothing yet, ask me later",
  ],
} as const;

// =============================================================================
// Private card, group: boundaries (`always_attached`)
// =============================================================================

/** hard nos (multi) + write your own. Fixed chips are uncapped. */
export const HARD_NO_OPTIONS = [
  "no pics unasked",
  "no substances",
  "no drinking",
  "nothing off campus",
  "no meeting the first week",
  "meet in public first",
  "daytime only at first",
  "no calls",
  "no video",
  "i don't host",
  "no going to yours first time",
  "no picking me up first time",
  "no smoking around me",
  "no bringing friends",
  "no impact",
  "no marks",
  "no restraints",
  "no filming",
  "no photos",
  "sober only",
] as const;

/** A typed hard no is at most 60 characters. */
export const HARD_NO_MAX_LENGTH = 60;
/** At most five typed hard nos (fixed chips are uncapped). */
export const HARD_NO_MAX_TYPED = 5;

/** privacy (multi). */
export const PRIVACY_OPTIONS = [
  "don't tell mutual friends",
  "don't post about us",
  "don't add me on other apps yet",
  "don't bring this up on campus",
  "i'm not out to everyone",
  "keep this between us",
] as const;

// =============================================================================
// Structure: payload keys, public cards, private-card groups
// =============================================================================

/** The 16 keys of an identity payload v2, in render order. */
export const IDENTITY_FIELDS = [
  "pronouns",
  "orientation",
  "interested_in",
  "relationship",
  "languages",
  "faith",
  "faith_weight",
  "politics",
  "politics_weight",
  "drinking",
  "smoking",
  "four_twenty",
  "kids",
  "when_free",
  "communication",
  "photos_content",
] as const;

/** The public cards in render order (brief §2 "Rendering", after `about`). */
export const IDENTITY_CARD_ORDER = [
  "identity",
  "background",
  "lifestyle",
  "around",
  "before_you_message",
] as const;

/** Which payload keys each public card renders. */
export const IDENTITY_CARDS = {
  identity: ["pronouns", "orientation", "interested_in", "relationship"],
  background: ["languages", "faith", "faith_weight", "politics", "politics_weight"],
  lifestyle: ["drinking", "smoking", "four_twenty", "kids"],
  around: ["when_free", "communication"],
  before_you_message: ["photos_content"],
} as const;

/** `faith_weight`/`politics_weight` render as a sub-line under their parent. */
export const WEIGHT_PARENTS = {
  faith_weight: "faith",
  politics_weight: "politics",
} as const;

/** The 9 keys of a private-card payload v2, in group order. */
export const CARD_SECTIONS = [
  "shows_interest",
  "pace",
  "living_situation",
  "hosting",
  "safer_sex",
  "dynamics",
  "practices",
  "hard_nos",
  "privacy",
] as const;

/** Private-card groups in render order. */
export const CARD_GROUP_ORDER = ["standard", "gated", "always_attached"] as const;

/**
 * Share semantics (ruling 6): `standard` is always included in a share,
 * `always_attached` (boundaries) is always attached, and only `gated`
 * sections are ticked per share (`shares.card_sections`) and revealed by tap.
 */
export const CARD_GROUPS = {
  standard: ["shows_interest", "pace", "living_situation", "hosting"],
  gated: ["safer_sex", "dynamics", "practices"],
  always_attached: ["hard_nos", "privacy"],
} as const;

/** Fields that hold one value (a string or null) rather than an array. */
export const SINGLE_FIELDS = [
  "relationship",
  "faith",
  "faith_weight",
  "politics",
  "politics_weight",
  "drinking",
  "smoking",
  "four_twenty",
  "kids",
  "pace",
  "living_situation",
  "hosting",
] as const;
