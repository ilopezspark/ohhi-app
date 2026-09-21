import { StyleSheet, View } from 'react-native';
import { Chip, Sheet, Surface, Text } from '../ui';
import { colors, spacing } from '../theme/tokens';

export interface DetailsSheetProps {
  visible: boolean;
  firstName: string;
  pronouns?: string | null;
  orientation?: string[];
  onDismiss: () => void;
}

/**
 * `Profile-Details.html` — "more about {name}", trimmed to the fields this
 * app actually has a data source for. The mockup also shows "into", "safer
 * sex", "kinks" and "hard nos" groups, but nothing in this app's API layer
 * (`api/identity.ts`, `api/profileCard.ts`) carries that data — only
 * pronouns/orientation exist (the `identity` edge function) — so those four
 * groups aren't fabricated here; see `app/README.md`'s design-section
 * deviation list.
 *
 * Deviation 1 (`docs/design/system.md`): the mockup renders pronouns/
 * orientation unconditionally, but `getIdentity` already 404s (returns
 * `null`) whenever the target's `is_public` is off — this sheet is only ever
 * opened once the caller already has non-null identity data, so the gate is
 * enforced by its caller (`ProfileScreen`), not duplicated here.
 */
export function DetailsSheet({ visible, firstName, pronouns, orientation = [], onDismiss }: DetailsSheetProps) {
  if (!visible) return null;

  return (
    <Sheet testID="profile-details-sheet" onDismiss={onDismiss}>
      <Surface style={styles.card}>
        <View style={styles.titleRow}>
          <Text variant="rowLabel">{`more about ${firstName}`}</Text>
          <Text variant="helper" color={colors.muted}>
            she shared this with you. only you.
          </Text>
        </View>

        {pronouns ? (
          <View style={styles.group}>
            <Text variant="label">pronouns</Text>
            <View style={styles.chips}>
              <Chip label={pronouns} tone="tint" />
            </View>
          </View>
        ) : null}

        {orientation.length > 0 ? (
          <View style={styles.group}>
            <Text variant="label">i&apos;m</Text>
            <View style={styles.chips}>
              {orientation.map((label) => (
                <Chip key={label} label={label} tone="tint" />
              ))}
            </View>
          </View>
        ) : null}
      </Surface>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.lg },
  titleRow: { gap: spacing.xxs },
  group: { gap: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.smMd },
});
