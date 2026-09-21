import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { me } from '../../../api/me';
import { REPORT_CATEGORIES, REPORT_NOTE_MAX_LENGTH, submitReport, type ReportCategory } from '../../../api/reports';
import { mapSupabaseError } from '../../../api/errors';
import { ConfirmButton } from '../../../settings/ConfirmButton';
import { Button, Input, Text } from '../../../ui';
import { colors, radii, shadows, spacing } from '../../../theme/tokens';

/**
 * `/settings/report/[id]` renders `Profile-Report.html`'s content: a
 * "report x" title, one chip per category (styled as `.chip` rows with a
 * radio dot, matching the mockup's `<label class="chip">…<input
 * type="radio">` rows), the optional note field, and a confirm button.
 *
 * Deviation: the mockup's button reads "send report & block" — this build's
 * `submitReport()` (plan §4) only ever inserts into `reports`; there is no
 * combined report+block RPC, and adding an extra `blockUser()` call here
 * would silently change behaviour a passing test
 * (`settings-report-screen.test.tsx`) already pins to "submit only". Kept
 * as "submit report", not the mockup's literal copy.
 *
 * `context`/`context_id` (from the query params `context` and
 * `conversationId`, matching the profile card's and chat's calling
 * contract) populate `context_type`/`context_id` on the insert. No severity
 * control anywhere here — decision 9 computes it server-side
 * unconditionally.
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
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.center} testID="report-hidden">
          <Text variant="body" color={colors.muted} style={styles.centerText}>
            Reporting isn&apos;t available right now.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (submitted) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.center} testID="report-thanks">
          <Text variant="titleLg" style={styles.centerText}>
            Thanks — we&apos;ll review this.
          </Text>
          <Button testID="report-done" label="Done" onPress={() => router.back()} fullWidth={false} />
        </View>
      </SafeAreaView>
    );
  }

  const errorMessage = mutation.isError ? mapSupabaseError(mutation.error).message : null;
  const noteTooLong = note.length > REPORT_NOTE_MAX_LENGTH;
  const canSubmit = !!category && !noteTooLong && !mutation.isPending;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.container} testID="report-screen">
        <Text variant="titleLg">Report this profile</Text>

        <View style={styles.categoryList} testID="report-category-list">
          {REPORT_CATEGORIES.map((option) => {
            const selected = category === option.value;
            return (
              <Pressable
                key={option.value}
                testID={`report-category-${option.value}`}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={[styles.categoryItem, shadows.sm, selected && styles.categoryItemSelected]}
                onPress={() => setCategory(option.value)}
              >
                <Text variant="rowLabel" color={selected ? colors.onDark : colors.ink} style={styles.categoryText}>
                  {option.label}
                </Text>
                <View style={[styles.radio, selected && styles.radioSelected]} />
              </Pressable>
            );
          })}
        </View>

        <Input
          testID="report-note"
          placeholder="Anything else we should know? (optional)"
          multiline
          maxLength={REPORT_NOTE_MAX_LENGTH + 50}
          value={note}
          onChangeText={setNote}
        />
        {noteTooLong ? (
          <Text variant="helper" color={colors.danger} testID="report-note-error">{`Keep it under ${REPORT_NOTE_MAX_LENGTH} characters.`}</Text>
        ) : null}

        {errorMessage ? (
          <Text variant="helper" color={colors.danger} testID="report-error">
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
        <Text
          testID="report-cancel"
          variant="rowLabel"
          color={colors.muted}
          style={styles.cancel}
          onPress={() => (mutation.isPending ? undefined : router.back())}
        >
          Cancel
        </Text>
        <Text variant="helper" style={styles.footerHint}>
          reports go to a person, not a bot. every account here is tied to a real ID, so this matters.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  container: { flex: 1, padding: spacing.xlXxl, gap: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.lg },
  centerText: { textAlign: 'center' },
  categoryList: { gap: spacing.smMd },
  categoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  categoryItemSelected: { backgroundColor: colors.ink },
  categoryText: { flexShrink: 1 },
  radio: { width: 16, height: 16, borderRadius: radii.circle, borderWidth: 2, borderColor: colors.dashed },
  radioSelected: { borderColor: colors.onDark, backgroundColor: colors.onDark },
  cancel: { textAlign: 'center', marginTop: spacing.xs },
  footerHint: { textAlign: 'center' },
});
