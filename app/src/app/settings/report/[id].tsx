import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { me } from '../../../api/me';
import { REPORT_CATEGORIES, REPORT_NOTE_MAX_LENGTH, submitReport, type ReportCategory } from '../../../api/reports';
import { mapSupabaseError } from '../../../api/errors';
import { ConfirmButton } from '../../../settings/ConfirmButton';

/**
 * `/settings/report/[id]` — the report form (plan §4). `context`/`context_id`
 * (from the query params `context` and `conversationId`, matching the
 * profile card's and chat's calling contract) populate `context_type`/
 * `context_id` on the insert. No severity control anywhere here — decision 9
 * computes it server-side unconditionally.
 *
 * Decision 47 / plan open question 4: the entry point is hidden whenever
 * `me().status !== 'active'`, since the `reports` insert requires
 * `private.is_active`. Rather than a 42501 on submit, this gates the whole
 * form behind a `me()` read.
 */
export default function ReportScreen() {
  const params = useLocalSearchParams<{ id: string; context?: string; conversationId?: string }>();
  const targetId = Array.isArray(params.id) ? params.id[0] : params.id ?? '';
  const context = Array.isArray(params.context) ? params.context[0] : params.context;
  const conversationId = Array.isArray(params.conversationId) ? params.conversationId[0] : params.conversationId;

  const meQuery = useQuery({ queryKey: ['me'], queryFn: me });

  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      submitReport({
        subjectId: targetId,
        category: category as ReportCategory,
        note: note.trim().length > 0 ? note.trim() : null,
        contextType: context === 'chat' ? 'chat' : 'profile',
        contextId: (context === 'chat' ? conversationId : targetId) ?? null,
      }),
    onSuccess: () => setSubmitted(true),
  });

  useEffect(() => {
    setSubmitted(false);
  }, [targetId]);

  if (meQuery.isPending) {
    return (
      <View style={styles.center} testID="report-loading">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // Decision 47: hidden, not a failed submit, for a non-active caller.
  if (meQuery.data?.status !== 'active') {
    return (
      <View style={styles.center} testID="report-hidden">
        <Text style={styles.hiddenText}>Reporting isn&apos;t available right now.</Text>
      </View>
    );
  }

  if (submitted) {
    return (
      <View style={styles.center} testID="report-thanks">
        <Text style={styles.thanksTitle}>Thanks — we&apos;ll review this.</Text>
        <Pressable testID="report-done" style={styles.doneButton} onPress={() => router.back()}>
          <Text style={styles.doneButtonText}>Done</Text>
        </Pressable>
      </View>
    );
  }

  const errorMessage = mutation.isError ? mapSupabaseError(mutation.error).message : null;
  const noteTooLong = note.length > REPORT_NOTE_MAX_LENGTH;
  const canSubmit = !!category && !noteTooLong && !mutation.isPending;

  return (
    <View style={styles.container} testID="report-screen">
      <Text style={styles.title}>Report this profile</Text>

      <View style={styles.categoryList} testID="report-category-list">
        {REPORT_CATEGORIES.map((option) => {
          const selected = category === option.value;
          return (
            <Pressable
              key={option.value}
              testID={`report-category-${option.value}`}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={[styles.categoryItem, selected && styles.categoryItemSelected]}
              onPress={() => setCategory(option.value)}
            >
              <Text style={[styles.categoryText, selected && styles.categoryTextSelected]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <TextInput
        testID="report-note"
        style={styles.note}
        placeholder="Anything else we should know? (optional)"
        multiline
        maxLength={REPORT_NOTE_MAX_LENGTH + 50}
        value={note}
        onChangeText={setNote}
      />
      {noteTooLong ? (
        <Text style={styles.error} testID="report-note-error">{`Keep it under ${REPORT_NOTE_MAX_LENGTH} characters.`}</Text>
      ) : null}

      {errorMessage ? (
        <Text style={styles.error} testID="report-error">
          {errorMessage}
        </Text>
      ) : null}

      <ConfirmButton
        testID="report-submit"
        label="Submit report"
        busy={mutation.isPending}
        disabled={!category || noteTooLong}
        onPress={() => canSubmit && mutation.mutate()}
      />
      <Text testID="report-cancel" style={styles.cancel} onPress={() => (mutation.isPending ? undefined : router.back())}>
        Cancel
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: '700' },
  categoryList: { gap: 8 },
  categoryItem: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  categoryItemSelected: { borderColor: '#208AEF', backgroundColor: '#eaf4ff' },
  categoryText: { fontSize: 15, color: '#222' },
  categoryTextSelected: { color: '#208AEF', fontWeight: '600' },
  note: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 80,
    fontSize: 15,
  },
  error: { color: '#B00020', fontSize: 13 },
  cancel: { textAlign: 'center', color: '#555', fontSize: 15, marginTop: 4 },
  hiddenText: { color: '#666', fontSize: 15, textAlign: 'center' },
  thanksTitle: { fontSize: 18, fontWeight: '600', textAlign: 'center' },
  doneButton: { backgroundColor: '#208AEF', borderRadius: 8, paddingHorizontal: 24, paddingVertical: 10 },
  doneButtonText: { color: '#fff', fontWeight: '600' },
});
