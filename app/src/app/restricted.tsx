import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import type { RestrictedStatus } from '../routing/stateToRoute';

/**
 * One shared "account restricted" screen with per-state copy, for
 * closed_age/suspended/banned/deleted — architecture plan §10 open question
 * 3's recommended default. Exact copy is **Needs brief**; the strings below
 * are this skeleton's placeholder, same posture as the architecture note.
 */
const COPY: Record<RestrictedStatus, { title: string; body: string }> = {
  closed_age: {
    title: "You're not old enough yet",
    body: 'OhHi is for users 18 and up. This account cannot continue.',
  },
  suspended: {
    title: 'Your account is suspended',
    body: 'Contact support if you think this is a mistake.',
  },
  banned: {
    title: 'Your account is banned',
    body: 'This decision is final and cannot be appealed in-app.',
  },
  deleted: {
    title: 'Account unavailable',
    body: 'Something went wrong loading your account. Please reopen the app.',
  },
};

const KNOWN_STATUSES = new Set<RestrictedStatus>(['closed_age', 'suspended', 'banned', 'deleted']);
const DEFAULT_STATUS: RestrictedStatus = 'suspended';

function isRestrictedStatus(value: string | undefined): value is RestrictedStatus {
  return !!value && KNOWN_STATUSES.has(value as RestrictedStatus);
}

export default function RestrictedScreen() {
  const { status } = useLocalSearchParams<{ status?: string }>();
  const copy = COPY[isRestrictedStatus(status) ? status : DEFAULT_STATUS];

  return (
    <View style={styles.container} testID="restricted-screen">
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.body}>{copy.body}</Text>
      <Pressable onPress={() => Linking.openURL('mailto:support@sayohhi.com')}>
        <Text style={styles.link}>Contact support</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center', gap: 12 },
  title: { fontSize: 20, fontWeight: '600' },
  body: { color: '#555', fontSize: 14 },
  link: { color: '#208AEF', marginTop: 16, fontWeight: '600' },
});
