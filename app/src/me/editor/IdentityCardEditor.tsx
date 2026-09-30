import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { IDENTITY_FIELD_LABELS } from '../card/fieldLabels';
import { IDENTITY_FIELD_SPECS, isFilled, type IdentityCard, type IdentityField } from '../../profile/fields';
import { Button, ChipGroup, Text } from '../../ui';
import { colors, spacing } from '../../theme/tokens';
import { AudienceRow } from './AudienceRow';
import { FieldNote } from './FieldEditorFrame';
import { FieldPicker } from './FieldPicker';
import { rowFields, weightOf } from './identityCardDraft';
import type { IdentityCardEditor } from './useIdentityCardEditor';

/** The card editors' heading size: "before you message me" fits one line at this size on a phone. */
export const CARD_EDITOR_TITLE_SIZE = 24;

/** The line under each card editor's heading, and the standing notes a card carries. */
const CARD_INTROS: Record<IdentityCard, string> = {
  identity: 'all optional. pick as much or as little as you want.',
  background: 'all optional. how much it matters only shows once you pick the one above it.',
  lifestyle: 'all optional. pick as much or as little as you want.',
  around: 'all optional. pick as much or as little as you want.',
  before_you_message: 'what you are asking of anyone who wants to message you.',
};

/**
 * Owner ruling 4: these are requests, and the editor says the app cannot
 * guarantee them. The card has no audience row (ruling 1): once anything is
 * picked it shows to everyone, right before they message.
 */
const BEFORE_YOU_MESSAGE_NOTES = [
  "these are requests, not guarantees. ohhi can't stop a screenshot or someone saving what you send.",
  'once you pick any, everyone who opens your profile sees them, right before they message you.',
];

export const cardEditorStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  body: { paddingHorizontal: spacing.lgXl, paddingTop: spacing.smMd, paddingBottom: spacing.huge, gap: spacing.xl },
  footer: { paddingHorizontal: spacing.lgXl, paddingTop: spacing.mdLg },
});

/** The footer's `save`: off until something changed, and while a save is in flight. */
export function CardEditorSaveButton({ editor, testID }: { editor: IdentityCardEditor; testID: string }) {
  return (
    <Button
      testID={testID}
      label="save"
      onPress={editor.save}
      loading={editor.saving}
      disabled={!editor.dirty || editor.saving || !editor.draft}
    />
  );
}

/**
 * The scrolling body of one public card's editor: the intro, the audience
 * row (not on "before you message me"), then one `FieldPicker` per row in the
 * card's order, each weight nested under its parent and shown only once the
 * parent has a value. Loading and a failed first read are handled here, so
 * each route is only its heading, this, and the save footer.
 */
export function IdentityCardFields({ editor, testID }: { editor: IdentityCardEditor; testID: string }) {
  if (editor.loadFailed) {
    return (
      <View style={styles.center} testID={`${testID}-load-failed`}>
        <Text variant="body" color={colors.inkSoft}>
          {"that didn't load. try again."}
        </Text>
        <Pressable testID={`${testID}-retry`} accessibilityRole="button" onPress={editor.retry} style={styles.retry}>
          <Text variant="labelLg" color={colors.signal}>
            try again
          </Text>
        </Pressable>
      </View>
    );
  }

  const draft = editor.draft;
  if (!draft) {
    return (
      <View style={styles.center} testID={`${testID}-loading`}>
        <ActivityIndicator size="large" color={colors.ink} />
      </View>
    );
  }

  const card = editor.card;
  return (
    <>
      <Text variant="bodyMedium" color={colors.inkSoft} testID={`${testID}-intro`}>
        {CARD_INTROS[card]}
      </Text>
      {card === 'before_you_message' ? (
        <View style={styles.notes}>
          {BEFORE_YOU_MESSAGE_NOTES.map((note, i) => (
            <FieldNote key={i} text={note} testID={`${testID}-note-${i}`} />
          ))}
        </View>
      ) : null}
      {draft.audience ? <AudienceRow testID={`${testID}-audience`} value={draft.audience} onChange={editor.setAudience} /> : null}
      {rowFields(card).map((field) => {
        const weight = weightOf(field);
        const value = draft.values[field] ?? (IDENTITY_FIELD_SPECS[field].multiple ? [] : null);
        return (
          <FieldPicker
            key={field}
            field={field}
            value={value}
            onChange={(next) => editor.setValue(field, next)}
            error={editor.fieldErrors[field]}
            testID={`${testID}-${field}`}
          >
            {weight && isFilled(value) ? (
              <WeightPicker
                field={weight}
                value={(draft.values[weight] as string | null | undefined) ?? null}
                onChange={(next) => editor.setValue(weight, next)}
                testID={`${testID}-${weight}`}
              />
            ) : null}
          </FieldPicker>
        );
      })}
      {editor.saveError ? (
        <Text variant="helper" color={colors.danger} testID={`${testID}-error`}>
          {editor.saveError}
        </Text>
      ) : null}
    </>
  );
}

/** `faith_weight` / `politics_weight`: single-select, under its parent's chips, in the same card. */
function WeightPicker({
  field,
  value,
  onChange,
  testID,
}: {
  field: IdentityField;
  value: string | null;
  onChange: (next: string | null) => void;
  testID: string;
}) {
  const spec = IDENTITY_FIELD_SPECS[field];
  return (
    <View style={styles.weight} testID={`${testID}-section`}>
      <Text variant="micro" color={colors.inkSoft}>
        {IDENTITY_FIELD_LABELS[field]}
      </Text>
      <ChipGroup
        testID={testID}
        mode="one"
        size="sm"
        options={[...spec.options, ...(value && !spec.options.includes(value) ? [value] : [])].map((option) => ({
          value: option,
          label: option,
        }))}
        value={value ? [value] : []}
        onChange={(next) => onChange(next[0] ?? null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.lgXl, paddingVertical: spacing.huge },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.lgXl },
  notes: { gap: spacing.smMd },
  weight: { gap: spacing.smMd, paddingTop: spacing.xs },
});
