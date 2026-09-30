import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { IDENTITY_FIELD_LABELS } from '../card/fieldLabels';
import {
  IDENTITY_FIELD_SPECS,
  normalizeTypedEntry,
  typedEntries,
  type FieldSpec,
  type IdentityField,
  type TypedEntryRejection,
} from '../../profile/fields';
import { Chip, ChipGroup, Input, RowCard, SectionLabel, Text } from '../../ui';
import { colors, spacing } from '../../theme/tokens';

type MultiSpec = Extract<FieldSpec, { multiple: true }>;

/** The inline line for a "write your own" entry the app refuses before sending (the server stays authoritative). */
export function typedEntryErrorCopy(rejection: TypedEntryRejection | 'full', spec: MultiSpec): string {
  switch (rejection) {
    case 'too_long':
      return `keep it to ${spec.typed?.maxLength ?? 0} characters.`;
    case 'duplicate':
      return 'you already have that one.';
    case 'control_char':
      return "that has a character we can't save. try retyping it.";
    case 'too_many': {
      const max = spec.typed?.maxCount ?? 0;
      return max === 1 ? 'one of your own at most. take yours off to write a new one.' : `${max} of your own at most.`;
    }
    case 'full':
      return `${spec.maxItems ?? 0} at most. take one off first.`;
    case 'not_listed':
      return 'pick from the list for this one.';
    case 'empty':
    default:
      return 'type something first.';
  }
}

/** Options to show: the list, then anything held that is not on it (a typed entry, or a retired chip), so it can be taken off. */
function shownOptions(options: readonly string[], held: readonly string[]): { value: string; label: string }[] {
  return [...options, ...typedEntries(held, options)].map((option) => ({ value: option, label: option }));
}

export interface FieldPickerProps {
  field: IdentityField;
  value: string | null | string[];
  onChange: (next: string | null | string[]) => void;
  /** The word filter's line after a refused save. */
  error?: string;
  /** Rendered under the chips, inside the same card (a weight under its parent). */
  children?: ReactNode;
  testID: string;
}

/**
 * One public-profile field in its card editor: the owner's label
 * (`IDENTITY_FIELD_LABELS`, ruling 3), then its chips, single or multi as
 * `IDENTITY_FIELD_SPECS` says, with the total cap where the spec has one,
 * and a "write your own" entry where `typed` allows it (checked with
 * `normalizeTypedEntry`, the function's own rule; the word filter runs only
 * on the server, and its refusal comes back as `error`).
 */
export function FieldPicker({ field, value, onChange, error, children, testID }: FieldPickerProps) {
  const spec = IDENTITY_FIELD_SPECS[field];
  const label = IDENTITY_FIELD_LABELS[field];

  if (!spec.multiple) {
    const current = typeof value === 'string' ? value : null;
    return (
      <View style={styles.section} testID={`${testID}-section`}>
        <SectionLabel label={label} testID={`${testID}-label`} />
        <RowCard>
          <View style={styles.body}>
            <ChipGroup
              testID={testID}
              mode="one"
              options={shownOptions(spec.options, current ? [current] : [])}
              value={current ? [current] : []}
              onChange={(next) => onChange(next[0] ?? null)}
            />
            {children}
          </View>
        </RowCard>
        <FieldError text={error} testID={`${testID}-error`} />
      </View>
    );
  }

  const list = Array.isArray(value) ? value : [];
  return (
    <View style={styles.section} testID={`${testID}-section`}>
      <SectionLabel
        label={label}
        testID={`${testID}-label`}
        note={spec.maxItems !== null ? `${list.length} of ${spec.maxItems}` : undefined}
      />
      <RowCard>
        <View style={styles.body}>
          <ChipGroup
            testID={testID}
            mode="multi"
            max={spec.maxItems ?? undefined}
            options={shownOptions(spec.options, list)}
            value={list}
            onChange={onChange}
          />
          {spec.typed ? <TypedEntry spec={spec} held={list} onAdd={(entry) => onChange([...list, entry])} testID={`${testID}-typed`} /> : null}
          {children}
        </View>
      </RowCard>
      <FieldError text={error} testID={`${testID}-error`} />
    </View>
  );
}

function FieldError({ text, testID }: { text?: string; testID: string }) {
  if (!text) return null;
  return (
    <Text variant="helper" color={colors.danger} testID={testID}>
      {text}
    </Text>
  );
}

/** "write your own": a field and an `add` chip. The entry joins the list as a selected chip. */
function TypedEntry({ spec, held, onAdd, testID }: { spec: MultiSpec; held: string[]; onAdd: (entry: string) => void; testID: string }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const maxLength = spec.typed?.maxLength ?? 0;
  const length = text.trim().replace(/\s+/g, ' ').length;
  const tooLong = length > maxLength;

  function add() {
    const result = normalizeTypedEntry(text, spec, held);
    if (!result.ok) {
      setError(typedEntryErrorCopy(result.rejection ?? 'empty', spec));
      return;
    }
    if (spec.maxItems !== null && held.length >= spec.maxItems) {
      setError(typedEntryErrorCopy('full', spec));
      return;
    }
    onAdd(result.value);
    setText('');
    setError(null);
  }

  return (
    <View style={styles.typed}>
      <Input
        testID={testID}
        surface="card"
        placeholder="write your own"
        value={text}
        // A little past the cap, so the line saying so can show instead of the text just stopping.
        maxLength={maxLength + 10}
        autoCapitalize="none"
        returnKeyType="done"
        onSubmitEditing={add}
        onChangeText={(next) => {
          setText(next);
          setError(null);
        }}
        error={error ?? (tooLong ? typedEntryErrorCopy('too_long', spec) : undefined)}
        helper={`${length} of ${maxLength}`}
      />
      <Chip testID={`${testID}-add`} label="add" tone="action" onPress={add} disabled={length === 0} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.smMd },
  body: { padding: spacing.lgXl, gap: spacing.mdLg },
  typed: { gap: spacing.smMd },
});
