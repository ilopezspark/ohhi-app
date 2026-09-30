import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { ScreenHeader, Text } from '../../ui';
import { colors, spacing } from '../../theme/tokens';

/**
 * `/me/report-help` — Settings' "report someone" row. Ruling 13: this is a
 * short explainer, not a person picker — reports are always filed from the
 * person's own profile or a chat thread, via the overflow (⋯) menu, which
 * already exists at `/settings/report/[id]`.
 */
export default function ReportHelpScreen() {
  return (
    <View style={styles.safe}>
      <ScreenHeader title="report someone" titleSize={24} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.scroll} testID="report-help-screen">
        <Text variant="body" color={colors.muted}>
          there is no list to pick someone from here. open their profile or your chat with them,
          then use the overflow menu and choose report.
        </Text>
        <Text variant="body" color={colors.muted}>
          we read every report. blocking someone is separate and immediate — you do not need to
          report first.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  scroll: { paddingHorizontal: spacing.lgXl, paddingTop: spacing.xl, paddingBottom: spacing.huge, gap: spacing.xl },
});
