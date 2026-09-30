import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SUGGESTION_MAX_LENGTH, suggestTag } from '../api/tags';
import { InvalidInputError } from '../api/errors';
import { FIELD_ERROR_FALLBACK } from '../profile/fields';
import { Button, Chip, Input, Sheet, Text } from '../ui';
import { colors, spacing } from '../theme/tokens';

export interface SuggestTagSheetProps {
  /** Pre-filled from an empty search, so the person does not type it twice. */
  initialLabel?: string;
  /** The catalog's categories (server labels), for the optional category. */
  categories: { slug: string; label: string }[];
  onDismiss: () => void;
  testID?: string;
}

/**
 * `suggest a tag` (brief §1): a small sheet with a label (at most 40
 * characters) and an optional category. It writes to the review queue
 * through `suggest_tag` and confirms with a neutral line; it never adds
 * anything to the profile. Refusals (blank, too long, characters, the word
 * filter, five already waiting) are shown in the server's own words as the
 * app maps them, and the typed text stays so it can be edited.
 *
 * An in-tree `Sheet`, not a `SheetModal`: it holds a text field and rides
 * the keyboard with no dialog window involved (see `ui/Sheet.tsx`). The
 * picker mounts it as the last child of its root.
 */
export function SuggestTagSheet({ initialLabel = '', categories, onDismiss, testID = 'suggest-tag' }: SuggestTagSheetProps) {
  const [label, setLabel] = useState(initialLabel.slice(0, SUGGESTION_MAX_LENGTH));
  const [category, setCategory] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const trimmed = label.trim();

  async function send() {
    if (sending || trimmed.length === 0) return;
    setSending(true);
    setError(null);
    try {
      await suggestTag(trimmed, category);
      setSent(true);
    } catch (err) {
      setError(err instanceof InvalidInputError ? err.message : FIELD_ERROR_FALLBACK);
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet onDismiss={onDismiss} testID={testID}>
      <Text variant="titleLg" accessibilityRole="header">
        suggest a tag
      </Text>
      {sent ? (
        <>
          <Text variant="body" color={colors.inkSoft} testID={`${testID}-sent`}>
            thanks. it&apos;s in the queue for a look. it won&apos;t be added to your profile.
          </Text>
          <Button testID={`${testID}-done`} label="done" onPress={onDismiss} />
        </>
      ) : (
        <>
          <Text variant="helper" color={colors.inkSoft}>
            we look at every suggestion before it joins the list. sending one doesn&apos;t add it to your profile.
          </Text>
          <Input
            testID={`${testID}-label`}
            value={label}
            onChangeText={(text) => {
              setLabel(text);
              if (error) setError(null);
            }}
            placeholder="a tag you'd use"
            maxLength={SUGGESTION_MAX_LENGTH}
            autoCapitalize="none"
            autoFocus={initialLabel.length === 0}
            error={error ?? undefined}
            helper={`${label.length} of ${SUGGESTION_MAX_LENGTH}`}
            returnKeyType="send"
            onSubmitEditing={send}
          />
          <View style={styles.categories}>
            <Text variant="label">which section, if any</Text>
            {/* One scrolling row, so 18 sections never push the field under the keyboard on a small phone. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.chips}
            >
              {categories.map((option) => (
                <Chip
                  key={option.slug}
                  testID={`${testID}-category-${option.slug}`}
                  label={option.label}
                  tone="tint"
                  size="sm"
                  selected={category === option.slug}
                  onPress={() => setCategory((prev) => (prev === option.slug ? null : option.slug))}
                />
              ))}
            </ScrollView>
          </View>
          <Button
            testID={`${testID}-send`}
            label="send suggestion"
            onPress={send}
            loading={sending}
            disabled={sending || trimmed.length === 0}
          />
          <Button testID={`${testID}-cancel`} label="cancel" variant="ghost" onPress={onDismiss} />
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  categories: { gap: spacing.smMd },
  chips: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xxs },
});
