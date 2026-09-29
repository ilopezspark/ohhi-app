import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { CARD_FIELDS } from '../../settings/vocab';
import { Chip, Text } from '../../ui';
import { LockIcon } from '../../ui/icons';
import { colors, radii, spacing } from '../../theme/tokens';
import { CARD_FIELD_LABELS } from './fieldLabels';

export interface PrivateCardEntries {
  into: string[];
  safer_sex: string[];
  kinks: string[];
  hard_nos: string[];
}

export interface PrivateCardViewProps {
  /**
   * The card owner's first name, or `"you"` for the sender's own outgoing
   * bubble (`chat/ShareBubble.tsx`) — interpolated into `more about <name>`.
   */
  name: string;
  /**
   * Full entries to render as grouped chip rows, in the ruled order (rulings
   * 1/3/5: into, safer sex, kinks, hard nos — hard nos always last), empty
   * groups omitted, hard nos in boundary colours (ruling 8). Omit entirely
   * for a compact, header-only rendering — the title/lock-tile/`private`
   * label only, no groups — which is what `chat/ShareBubble.tsx`'s inline
   * bubble uses, so the bubble and `/me/private-card`'s full "how it arrives
   * in a chat" preview both render through this one component.
   */
  entries?: PrivateCardEntries;
  /** Overrides the title colour — `chat/ShareBubble.tsx` passes `colors.onDark` for its own dark "mine" bubble. Defaults to `colors.ink`. */
  titleColor?: string;
  /** Overrides the `private` label / group-label colour, same reasoning as `titleColor`. Defaults to `colors.inkSoft`. */
  mutedColor?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * `docs/design/me-redesign/brief.md`'s "how it arrives in a chat" card
 * (`02-private-card.png`): the private card exactly as a recipient sees it.
 * Deliberately owns content only, not the surrounding card chrome (white
 * background, shadow, padding) — `/me/private-card.tsx` and
 * `chat/ShareBubble.tsx` each sit inside a different surface (a plain white
 * card vs. a chat bubble that's dark when it's the sender's own message), so
 * the chrome stays with the caller and only the content — which must be
 * identical in both places for "how it arrives in a chat" to be literally
 * true — lives here.
 *
 * Per ruling 1, pronouns and orientation are never rendered here — the
 * artboards draw them inside the card, but the rulings move them to their
 * own "about you" screen, public-profile-only.
 */
export function PrivateCardView({
  name,
  entries,
  titleColor = colors.ink,
  mutedColor = colors.inkSoft,
  style,
  testID = 'private-card-view',
}: PrivateCardViewProps) {
  const groups = entries ? CARD_FIELDS.filter((field) => entries[field].length > 0) : [];

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
          {groups.map((field) => (
            <View key={field} style={styles.group} testID={`${testID}-group-${field}`}>
              <Text variant="micro" color={mutedColor}>
                {CARD_FIELD_LABELS[field]}
              </Text>
              <View style={styles.chipRow}>
                {entries![field].map((value) => (
                  <Chip
                    key={value}
                    testID={`${testID}-group-${field}-${value}`}
                    label={value}
                    tone={field === 'hard_nos' ? 'boundary' : 'tint'}
                  />
                ))}
              </View>
            </View>
          ))}
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
  groups: { marginTop: spacing.lgXl, gap: spacing.lgXl },
  group: { gap: spacing.smMd },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.smMd },
});
