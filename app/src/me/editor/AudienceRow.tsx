import { StyleSheet, View } from 'react-native';
import { AUDIENCE_LABELS } from '../card/fieldLabels';
import { GATED_NOTE, type Audience } from '../../profile/fields';
import { AUDIENCES } from '../../settings/vocab';
import { ChipGroup, RowCard, SectionLabel, Text } from '../../ui';
import { colors, spacing } from '../../theme/tokens';

/** What each choice means, under the chips. `after_hi` is the same gate as usual places and gated prompts. */
const AUDIENCE_HINTS: Record<Audience, string> = {
  everyone: 'anyone on your campus who opens your profile.',
  after_hi: GATED_NOTE,
  only_me: 'hidden from everyone else. you can still fill it in.',
};

export interface AudienceRowProps {
  value: Audience;
  onChange: (next: Audience) => void;
  testID: string;
}

/**
 * "who sees this" at the top of a public card's editor (owner ruling 1):
 * everyone / after a hi is answered / only me, one always picked (a new card
 * starts at everyone). Saved with the card as its `audiences` key.
 */
export function AudienceRow({ value, onChange, testID }: AudienceRowProps) {
  return (
    <View style={styles.section} testID={testID}>
      <SectionLabel label="who sees this" />
      <RowCard>
        <View style={styles.body}>
          <ChipGroup
            testID={`${testID}-choice`}
            mode="one"
            options={AUDIENCES.map((audience) => ({ value: audience, label: AUDIENCE_LABELS[audience] }))}
            value={[value]}
            // Tapping the picked one again would clear it; there is always an audience, so that is a no-op.
            onChange={(next) => {
              if (next[0]) onChange(next[0] as Audience);
            }}
          />
          <Text variant="micro" color={colors.inkSoft} testID={`${testID}-hint`}>
            {AUDIENCE_HINTS[value]}
          </Text>
        </View>
      </RowCard>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.smMd },
  body: { padding: spacing.lgXl, gap: spacing.mdLg },
});
