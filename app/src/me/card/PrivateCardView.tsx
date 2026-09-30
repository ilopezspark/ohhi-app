import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { CARD_GROUP_ORDER } from '../../settings/vocab';
import type { CardGroup, CardPayload, GatedSection } from '../../profile/fields';
import { Chip, Text } from '../../ui';
import { LockIcon } from '../../ui/icons';
import { colors, radii, spacing } from '../../theme/tokens';
import { CARD_GROUP_LABELS, CARD_SECTION_ROWS, type CardSectionRow } from './fieldLabels';
import { CARD_GROUP_CAPTIONS } from './groupCaptions';
import { GatedCover } from './GatedCover';
import { inOptionOrder, sectionValues } from './cardValues';

export interface PrivateCardViewProps {
  /**
   * The card owner's first name, or `"you"` for the sender's own outgoing
   * bubble (`chat/ShareBubble.tsx`), interpolated into `more about <name>`.
   */
  name: string;
  /**
   * The sections to render (payload v2). Omit for the compact, header-only
   * rendering (title, lock tile, `private` label) that `chat/ShareBubble.tsx`
   * uses, so the bubble, the owner's preview and the recipient's sheet all
   * draw that header through this one component.
   */
  sections?: Partial<CardPayload>;
  /**
   * Recipient only: the intimacy sections this share ticked (`gated` from
   * `GET /identity/card/:owner`). Each renders as a neutral cover until
   * tapped; the tap fetches it (`GatedCover`). Needs `revealSection`.
   */
  gated?: readonly GatedSection[];
  /**
   * Fetches one gated section on the recipient's tap: the caller binds
   * `api/identity.ts#revealCardSection` to the owner. Kept as a prop so this
   * view has no API imports.
   */
  revealSection?: (section: GatedSection) => Promise<string[] | null>;
  /** A reveal came back empty (the share was taken back or changed): the caller re-reads the card. */
  onRevealGone?: () => void;
  /** Owner only: one line under each group saying what a share includes. */
  showGroupCaptions?: boolean;
  /** Overrides the title colour: `chat/ShareBubble.tsx` passes `colors.onDark` for its own dark "mine" bubble. Defaults to `colors.ink`. */
  titleColor?: string;
  /** Overrides the `private` label / group-label colour, same reasoning as `titleColor`. Defaults to `colors.inkSoft`. */
  mutedColor?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

interface GroupItem {
  row: CardSectionRow;
  /** Values to show as chips, or null for a cover. */
  values: string[] | null;
}

/**
 * The private card (payload v2) as it reads in both places it appears: the
 * owner's own preview (`/me/private-card`, everything, with per-group
 * captions) and the recipient's sheet (`chat/PrivateCardSheet.tsx`: the
 * getting-closer group and the boundaries, plus a cover per ticked intimacy
 * section). Groups in order, getting closer, intimacy, boundaries, with hard
 * nos then privacy last in the boundary colours (me-redesign ruling 5,
 * extended to privacy; reconcile ruling 7). Empty sections and empty groups
 * are skipped; a single-value section (pace, living situation, hosting) is
 * one chip.
 *
 * Owns content only, not the surrounding chrome (the white card, a chat
 * bubble), which stays with each caller.
 *
 * Revealed values live in this component's state only: they go when the
 * sheet closes, and a section that drops out of `gated` on a re-read (the
 * share was taken back or changed) stops showing at once, revealed or not.
 */
export function PrivateCardView({
  name,
  sections,
  gated = [],
  revealSection,
  onRevealGone,
  showGroupCaptions = false,
  titleColor = colors.ink,
  mutedColor = colors.inkSoft,
  style,
  testID = 'private-card-view',
}: PrivateCardViewProps) {
  const [revealed, setRevealed] = useState<Partial<Record<GatedSection, string[]>>>({});

  const groups: { group: CardGroup; items: GroupItem[] }[] = sections
    ? CARD_GROUP_ORDER.map((group) => ({
        group,
        items: CARD_SECTION_ROWS.filter((row) => row.group === group).flatMap((row): GroupItem[] => {
          const section = row.section;
          if (group === 'gated' && gated.includes(section as GatedSection)) {
            const shown = revealed[section as GatedSection];
            if (shown) return shown.length > 0 ? [{ row, values: inOptionOrder(section, shown) }] : [];
            return revealSection ? [{ row, values: null }] : [];
          }
          const values = sectionValues(sections[section]);
          return values.length > 0 ? [{ row, values: inOptionOrder(section, values) }] : [];
        }),
      })).filter(({ items }) => items.length > 0)
    : [];

  return (
    <View style={style} testID={testID}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.lockTile} testID={`${testID}-lock`}>
            <LockIcon size={18} color={colors.ink} />
          </View>
          <Text variant="title" color={titleColor} testID={`${testID}-title`} numberOfLines={1} style={styles.title}>
            {`more about ${name}`}
          </Text>
        </View>
        <Text variant="captionMuted" color={mutedColor} style={styles.privateLabel} testID={`${testID}-label`}>
          private
        </Text>
      </View>

      {groups.length > 0 ? (
        <View style={styles.groups}>
          {groups.map(({ group, items }) => {
            const boundary = group === 'always_attached';
            return (
              <View key={group} style={[styles.group, boundary && styles.boundaryGroup]} testID={`${testID}-group-${group}`}>
                <View style={styles.groupHead}>
                  <Text variant="sectionLabel" color={boundary ? colors.boundaryInk : mutedColor}>
                    {CARD_GROUP_LABELS[group]}
                  </Text>
                  {showGroupCaptions ? (
                    <Text variant="micro" color={colors.inkSoft} testID={`${testID}-caption-${group}`}>
                      {CARD_GROUP_CAPTIONS[group]}
                    </Text>
                  ) : null}
                </View>
                {items.map(({ row, values }) =>
                  values === null ? (
                    <GatedCover
                      key={row.section}
                      reveal={revealSection!}
                      section={row.section as GatedSection}
                      onRevealed={(next) => setRevealed((prev) => ({ ...prev, [row.section]: next }))}
                      onGone={onRevealGone}
                      testID={`${testID}-cover-${row.section}`}
                    />
                  ) : (
                    <View key={row.section} style={styles.section} testID={`${testID}-section-${row.section}`}>
                      <Text variant="micro" color={boundary ? colors.boundaryInk : mutedColor}>
                        {row.label}
                      </Text>
                      <View style={styles.chipRow}>
                        {values.map((value) => (
                          <Chip
                            key={value}
                            testID={`${testID}-section-${row.section}-${value}`}
                            label={value}
                            tone={boundary ? 'boundary' : 'tint'}
                          />
                        ))}
                      </View>
                    </View>
                  )
                )}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.mdLg,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.smMd, flexShrink: 1 },
  lockTile: {
    width: 36,
    height: 36,
    borderRadius: radii.circle,
    backgroundColor: colors.paperTint,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  title: { flexShrink: 1 },
  privateLabel: { textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0 },
  groups: { marginTop: spacing.lgXl, gap: spacing.xl },
  group: { gap: spacing.mdLg },
  // The boundaries sit in a warm-bordered box, the same border as the editor's.
  boundaryGroup: {
    borderWidth: 1.5,
    borderColor: colors.boundaryInk,
    borderRadius: radii.card,
    padding: spacing.mdLg,
  },
  groupHead: { gap: 2 },
  section: { gap: spacing.smMd },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.smMd },
});
