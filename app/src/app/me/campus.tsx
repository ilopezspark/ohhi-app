import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { me as fetchMe } from '../../api/me';
import { Header, RowCard, SettingsRow, Text } from '../../ui';
import { colors, spacing } from '../../theme/tokens';
import { queryKeys } from '../../me/queryKeys';
import { getCampusDetail } from '../../me/settings/queries';

/**
 * `/me/campus` — ruling 14: "the chevron opens a read-only screen. no
 * campus switching exists." So this reads and shows the campus, and offers
 * nothing to change.
 */
export default function CampusScreen() {
  const meQuery = useQuery({ queryKey: queryKeys.me.result, queryFn: fetchMe });
  const campusId = meQuery.data?.campus_id ?? null;

  const campusQuery = useQuery({
    queryKey: ['me_campus_detail', campusId],
    queryFn: () => getCampusDetail(campusId as string),
    enabled: !!campusId,
  });

  const loading = meQuery.isLoading || (!!campusId && campusQuery.isLoading);
  const campus = campusQuery.data;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} testID="campus-screen">
        <Header title="my campus" titleSize={26} onBack={() => router.back()} />

        {loading ? (
          <View style={styles.center} testID="campus-loading">
            <ActivityIndicator size="large" color={colors.ink} />
          </View>
        ) : campus ? (
          <RowCard style={styles.cardPadding}>
            <SettingsRow title="campus" accessory={{ kind: 'value', text: campus.name }} />
            <SettingsRow title="city" accessory={{ kind: 'value', text: `${campus.city}, ${campus.state}` }} />
          </RowCard>
        ) : (
          <Text variant="body" color={colors.muted}>
            we could not load your campus right now.
          </Text>
        )}

        <Text variant="micro" color={colors.inkSoft}>
          there is no campus switching — if you have transferred, reach out and we will move you.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  scroll: { paddingHorizontal: spacing.lgXl, paddingTop: spacing.mdLg, paddingBottom: spacing.huge, gap: spacing.xl },
  center: { paddingVertical: spacing.huge, alignItems: 'center' },
  cardPadding: { paddingHorizontal: spacing.lgXl },
});
