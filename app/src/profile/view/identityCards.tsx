import type { ReactNode } from 'react';
import { ChatIcon, PeopleIcon, PersonIcon } from '../../ui';
import {
  ClockIcon,
  GlassIcon,
  GlobeIcon,
  HeartIcon,
  KidIcon,
  LeafIcon,
  RingsIcon,
  ScaleIcon,
  SmokeIcon,
  SparkIcon,
} from '../../ui/icons/IdentityIcons';
import { colors } from '../../theme/tokens';
import { WEIGHT_PARENTS } from '../../settings/vocab';
import { IDENTITY_CARD_ROWS } from '../../me/card/fieldLabels';
import type { Audience, Audiences, IdentityCard, IdentityCards, IdentityField } from '../fields';
import type { BasicsRow } from './sections';

/**
 * The public profile's five restructured cards (profile restructure, phase
 * 4b; `docs/design/profile-restructure/brief.md` §2 "Rendering", reconcile C4
 * and C8): identity, background, lifestyle, when i'm around, then before you
 * message me, in that order after `about`.
 *
 * Render exactly what the identity function returned: a viewer's `cards`
 * already holds only the cards their audience admits (`GET /identity/:id`),
 * so nothing here decides who sees what. A card whose rows are all empty is
 * skipped, a row with no value is skipped, and there is never a placeholder.
 * Rows are icon + value with the field's name as the sub-line; a list is
 * joined with " · "; `faith_weight` / `politics_weight` never get a row of
 * their own and ride on their parent's sub-line. Labels are the owner's
 * (ruling 3), from `me/card/fieldLabels.ts`. Nothing here filters or sorts
 * anyone (brief §6).
 */

/** The four cards drawn as icon rows; "before you message me" is drawn as its own boundary card. */
export type RowCard = Exclude<IdentityCard, 'before_you_message'>;

const ICON_SIZE = 20;
const ROW_ICONS: Record<Exclude<IdentityField, keyof typeof WEIGHT_PARENTS | 'photos_content'>, (color: string) => ReactNode> = {
  pronouns: (color) => <PersonIcon size={ICON_SIZE} color={color} />,
  orientation: (color) => <HeartIcon size={ICON_SIZE} color={color} />,
  interested_in: (color) => <PeopleIcon size={ICON_SIZE} color={color} />,
  relationship: (color) => <RingsIcon size={ICON_SIZE} color={color} />,
  languages: (color) => <GlobeIcon size={ICON_SIZE} color={color} />,
  faith: (color) => <SparkIcon size={ICON_SIZE} color={color} />,
  politics: (color) => <ScaleIcon size={ICON_SIZE} color={color} />,
  drinking: (color) => <GlassIcon size={ICON_SIZE} color={color} />,
  smoking: (color) => <SmokeIcon size={ICON_SIZE} color={color} />,
  four_twenty: (color) => <LeafIcon size={ICON_SIZE} color={color} />,
  kids: (color) => <KidIcon size={ICON_SIZE} color={color} />,
  when_free: (color) => <ClockIcon size={ICON_SIZE} color={color} />,
  communication: (color) => <ChatIcon size={ICON_SIZE} color={color} />,
};

/** The header glyph of each row card. */
export const CARD_HEADER_ICONS: Record<RowCard, ReactNode> = {
  identity: <PersonIcon size={16} color={colors.muted} />,
  background: <GlobeIcon size={16} color={colors.muted} />,
  lifestyle: <GlassIcon size={16} color={colors.muted} />,
  around: <ClockIcon size={16} color={colors.muted} />,
};

/**
 * The owner's own preview only: what a card's audience means for everyone
 * else. `everyone` needs no note. Voice rules apply (these are the app's
 * words, not the owner's labels).
 */
export const AUDIENCE_NOTES: Record<Audience, string | null> = {
  everyone: null,
  after_hi: 'shown after a hi is answered',
  only_me: 'only you can see this',
};

const WEIGHT_OF: Partial<Record<IdentityField, IdentityField>> = Object.fromEntries(
  Object.entries(WEIGHT_PARENTS).map(([weight, parent]) => [parent, weight])
);

function isWeight(field: IdentityField): boolean {
  return field in WEIGHT_PARENTS;
}

/** A stored value as one line: a single value as is, a list joined with " · ", empty as null. */
export function joinValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim().length > 0 ? value : null;
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    return items.length > 0 ? items.join(' · ') : null;
  }
  return null;
}

export interface IdentityRowModel {
  field: IdentityField;
  /** The value line. */
  value: string;
  /** The field's name, and the weight after it for faith / politics (`faith · somewhat`). */
  secondary: string;
}

/** One card's rows, in the card's field order: empties and weights skipped, weights folded into the parent's sub-line. */
export function identityRowModels(card: IdentityCard, values: Record<string, unknown> | undefined): IdentityRowModel[] {
  if (!values) return [];
  const row = IDENTITY_CARD_ROWS.find((r) => r.card === card);
  if (!row) return [];
  const out: IdentityRowModel[] = [];
  for (const { field, label } of row.fields) {
    if (isWeight(field)) continue;
    const value = joinValue(values[field]);
    if (!value) continue;
    const weightField = WEIGHT_OF[field];
    const weight = weightField ? joinValue(values[weightField]) : null;
    out.push({ field, value, secondary: weight ? `${label} · ${weight}` : label });
  }
  return out;
}

/** `identityRowModels` as `BasicsCard` rows, with each field's glyph and a testID per row. */
export function identityCardRows(card: RowCard, values: Record<string, unknown> | undefined, prefix: string): BasicsRow[] {
  return identityRowModels(card, values).map((model) => ({
    key: model.field,
    icon: ROW_ICONS[model.field as keyof typeof ROW_ICONS]?.(colors.muted) ?? null,
    primary: model.value,
    secondary: model.secondary,
    testID: `${prefix}-card-${card}-${model.field}`,
  }));
}

export interface IdentityCardModel {
  card: RowCard;
  title: string;
  rows: BasicsRow[];
  /** Preview only: the audience note (`AUDIENCE_NOTES`); null for everyone and for a viewer. */
  note: string | null;
}

/**
 * The row cards to draw, in render order, each with at least one row. With
 * `audiences` (the owner's preview) a card that is not shown to everyone
 * carries its note; without (anyone else) there is never a note, since what
 * came back is already exactly what this viewer may see.
 */
export function identityCardModels(
  cards: Partial<IdentityCards>,
  prefix: string,
  audiences: Audiences | null = null
): IdentityCardModel[] {
  const out: IdentityCardModel[] = [];
  for (const { card, label } of IDENTITY_CARD_ROWS) {
    if (card === 'before_you_message') continue;
    const rows = identityCardRows(card, cards[card] as Record<string, unknown> | undefined, prefix);
    if (rows.length === 0) continue;
    out.push({ card, title: label, rows, note: audiences ? AUDIENCE_NOTES[audiences[card]] : null });
  }
  return out;
}

/** "before you message me": the person's photos & content requests, as set, blanks dropped. */
export function beforeYouMessageItems(cards: Partial<IdentityCards>): string[] {
  return (cards.before_you_message?.photos_content ?? []).filter((item) => item.trim().length > 0);
}

/** The card's title (the owner's label, ruling 3). */
export const BEFORE_YOU_MESSAGE_TITLE = IDENTITY_CARD_ROWS.find((r) => r.card === 'before_you_message')?.label ?? '';

/**
 * The one-line summary docked above say-hi (reconcile C4):
 * `{ lead: "before you message me", rest: "ask before you send anything +2" }`.
 * With `all`, every request is listed instead of the `+N` count (the
 * first-message sheet, where there is no second sheet to open). Null with
 * nothing set: the bar does not grow.
 */
export function beforeYouMessageLine(items: string[], all = false): { lead: string; rest: string } | null {
  if (items.length === 0) return null;
  if (all) return { lead: BEFORE_YOU_MESSAGE_TITLE, rest: items.join(' · ') };
  const more = items.length - 1;
  return { lead: BEFORE_YOU_MESSAGE_TITLE, rest: more > 0 ? `${items[0]} +${more}` : items[0] };
}
