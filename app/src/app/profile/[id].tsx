import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

/**
 * Placeholder for the viewer's profile card. The real screen —
 * `profile_card_for(target)` plus the `identity` edge function, the hi/message
 * compose entry points, report and block — belongs to the social slice
 * (`docs/app-social-plan.md`, architecture plan §2's screen inventory, owner:
 * social). This exists only so the grid's tile tap has somewhere to land.
 */
export default function ProfilePlaceholderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <View style={styles.container} testID="profile-placeholder">
      <Text style={styles.heading}>Profile</Text>
      <Text style={styles.id} testID="profile-placeholder-id">
        {id}
      </Text>
      <Text style={styles.note}>
        The profile card is built in the social slice — this is a placeholder so the grid has
        somewhere to navigate to.
      </Text>
      <Pressable
        accessibilityRole="button"
        testID="profile-placeholder-back"
        style={styles.back}
        onPress={() => router.back()}
      >
        <Text style={styles.backText}>Back</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
  heading: { fontSize: 20, fontWeight: '700' },
  id: { fontFamily: 'monospace', fontSize: 13, color: '#444' },
  note: { textAlign: 'center', color: '#666', fontSize: 13 },
  back: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#208AEF',
  },
  backText: { color: '#fff', fontWeight: '600' },
});
