import { ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ScreenHeader, Text } from '../../../ui';
import { colors, spacing } from '../../../theme/tokens';
import { infoLinkFor } from '../../../me/links';

/**
 * `/me/info/[slug]` — the one placeholder screen behind `src/me/links.ts`'s
 * constant map (ruling 12): "what we do with your id", "how to not get
 * banned", privacy, terms. None of the four has a real destination yet;
 * this says so plainly rather than 404ing or linking out to nothing.
 */
export default function InfoScreen() {
  const params = useLocalSearchParams<{ slug: string }>();
  const slug = Array.isArray(params.slug) ? params.slug[0] : params.slug ?? '';
  const link = infoLinkFor(slug);

  return (
    <View style={styles.safe}>
      <ScreenHeader title={link?.title ?? 'coming soon'} titleSize={22} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.scroll} testID="info-screen">
        <Text variant="body" color={colors.muted} testID="info-body">
          this page is not written yet. check back soon — for now, reach out if you have a question.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  scroll: { paddingHorizontal: spacing.lgXl, paddingTop: spacing.xl, paddingBottom: spacing.huge, gap: spacing.xl },
});
