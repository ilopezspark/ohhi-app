import type { CardGroup } from '../../profile/fields';

/**
 * What a share includes, per private-card group (owner ruling 6), for the
 * owner's own screens only (the editor and the `/me/private-card` preview).
 * A recipient never sees these. The group names themselves are the owner's
 * labels (`me/card/fieldLabels.ts#CARD_GROUP_LABELS`); this is the app's own
 * copy, so it follows the voice rules.
 */
export const CARD_GROUP_CAPTIONS: Record<CardGroup, string> = {
  standard: 'always goes with your card when you share it.',
  gated: 'only goes when you tick it for that person, and they tap to open each one.',
  always_attached: 'always attached to every share, and always shown last.',
};
