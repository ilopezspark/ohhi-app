import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import type { GatedSection } from '../../profile/fields';
import { Text } from '../../ui';
import { LockIcon } from '../../ui/icons';
import { colors, radii, spacing } from '../../theme/tokens';
import { CARD_SECTION_LABELS } from './fieldLabels';

export interface GatedCoverProps {
  section: GatedSection;
  /** Fetches the section (`api/identity.ts#revealCardSection`, bound to the owner by the caller); `null` on the 404. */
  reveal: (section: GatedSection) => Promise<string[] | null>;
  /** The section's values, fetched on this tap. */
  onRevealed: (values: string[]) => void;
  /** The reveal came back empty (404): the share was taken back or changed, or the section was emptied. */
  onGone?: () => void;
  testID: string;
}

/**
 * The neutral cover a recipient sees for each intimacy section the sender
 * ticked on this share (owner ruling 6, reconcile C3). It shows the section's
 * name and "tap to see", never a count, a preview or anything else about
 * what is inside. The content is fetched only on the tap
 * (`GET /identity/card/:owner/reveal/:section`), held in memory by the card
 * view, and never cached or recorded: nothing tells the owner a reveal
 * happened.
 */
export function GatedCover({ section, reveal: fetchSection, onRevealed, onGone, testID }: GatedCoverProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  async function reveal() {
    if (state === 'loading') return;
    setState('loading');
    try {
      const values = await fetchSection(section);
      if (values === null) {
        setState('idle');
        onGone?.();
        return;
      }
      onRevealed(values);
    } catch {
      setState('error');
    }
  }

  const label = CARD_SECTION_LABELS[section];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, tap to see`}
      accessibilityState={{ busy: state === 'loading' }}
      onPress={() => void reveal()}
      style={({ pressed }) => [styles.cover, pressed && styles.pressed]}
      testID={testID}
    >
      <View style={styles.icon}>
        {state === 'loading' ? (
          <ActivityIndicator size="small" color={colors.ink} testID={`${testID}-loading`} />
        ) : (
          <LockIcon size={16} color={colors.ink} />
        )}
      </View>
      <View style={styles.body}>
        <Text variant="rowLabel">{label}</Text>
        <Text variant="micro" color={state === 'error' ? colors.danger : colors.inkSoft} testID={`${testID}-hint`}>
          {state === 'error' ? "that didn't load. tap to try again." : 'tap to see'}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cover: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.mdLg,
    backgroundColor: colors.paperTint,
    borderRadius: radii.card,
    paddingVertical: spacing.mdLg,
    paddingHorizontal: spacing.lgXl,
  },
  pressed: { opacity: 0.7 },
  icon: {
    width: 32,
    height: 32,
    borderRadius: radii.circle,
    backgroundColor: colors.paperRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
});
