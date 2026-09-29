import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { FieldEditorFrame, FieldNote } from '../../me/editor/FieldEditorFrame';
import { REPEATED_PLACE_ERROR, USUAL_PLACES_GATE_NOTE } from '../../me/editor/listEdit';
import { useProfileEditorDraftContext } from '../../me/editor/ProfileEditorDraftContext';
import { useDiscardGuard } from '../../me/editor/useDiscardGuard';
import { firstRepeatedPlace, USUAL_PLACE_MAX_LENGTH, USUAL_PLACES_MAX } from '../../profile/fields';
import { Chip, Text, XIcon } from '../../ui';
import { colors, radii, shadows, spacing } from '../../theme/tokens';

/**
 * `/profile-editor/usual-places` (`docs/design/profile-redesign/brief.md`,
 * ruling 5): "around campus", up to 3 short entries of 30 characters each.
 * Gated: another person sees them only once a hi between the two has been
 * answered. Draft-model: `save` writes into the editor's draft and pops;
 * blank rows are dropped, a repeat is refused here the way the server
 * would (trimmed, ignoring case).
 */
export default function EditUsualPlacesScreen() {
  const draftState = useProfileEditorDraftContext();
  const initial = draftState.draft.usualPlaces;
  const [places, setPlaces] = useState<string[]>(initial.length > 0 ? initial : ['']);
  const [repeatAt, setRepeatAt] = useState(-1);

  const cleaned = places.map((place) => place.trim()).filter((place) => place.length > 0);
  const dirty = cleaned.length !== initial.length || cleaned.some((place, i) => place !== initial[i].trim());
  const guard = useDiscardGuard(dirty);

  function update(index: number, value: string) {
    setRepeatAt(-1);
    setPlaces((prev) => prev.map((place, i) => (i === index ? value : place)));
  }

  function remove(index: number) {
    setRepeatAt(-1);
    setPlaces((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length > 0 ? next : [''];
    });
  }

  function save() {
    // Index into `places` (what is on screen) of the first repeat among the non-blank rows.
    const filled = places.map((place, i) => ({ place, i })).filter(({ place }) => place.trim().length > 0);
    const repeated = firstRepeatedPlace(filled.map(({ place }) => place));
    if (repeated >= 0) {
      setRepeatAt(filled[repeated].i);
      return;
    }
    draftState.setUsualPlaces(cleaned);
    guard.leave();
  }

  return (
    <FieldEditorFrame
      testID="editor-usual-places"
      title="around campus"
      intro={`up to ${USUAL_PLACES_MAX} spots where you usually end up on campus.`}
      onCancel={guard.requestClose}
      onSave={save}
    >
      {places.map((place, index) => (
        <View key={index} style={styles.row} testID={`editor-usual-places-item-${index}`}>
          <View style={styles.fieldCard}>
            <TextInput
              testID={`editor-usual-places-item-${index}-input`}
              accessibilityLabel={`place ${index + 1}`}
              maxLength={USUAL_PLACE_MAX_LENGTH}
              value={place}
              onChangeText={(text) => update(index, text)}
              placeholder={index === 0 ? 'library, 2nd floor' : 'another spot'}
              placeholderTextColor={colors.subtle}
              style={styles.input}
            />
            <Text variant="micro" color={colors.inkSoft} testID={`editor-usual-places-item-${index}-counter`}>
              {`${place.length} / ${USUAL_PLACE_MAX_LENGTH}`}
            </Text>
            <Pressable
              testID={`editor-usual-places-item-${index}-remove`}
              accessibilityRole="button"
              accessibilityLabel={`remove place ${index + 1}`}
              onPress={() => remove(index)}
              hitSlop={6}
              style={styles.remove}
            >
              <XIcon size={16} color={colors.muted} />
            </Pressable>
          </View>
          {repeatAt === index ? (
            <Text variant="helper" color={colors.danger} testID={`editor-usual-places-item-${index}-error`}>
              {REPEATED_PLACE_ERROR}
            </Text>
          ) : null}
        </View>
      ))}

      {places.length < USUAL_PLACES_MAX ? (
        <View style={styles.addRow}>
          <Chip
            testID="editor-usual-places-add"
            label="add a place"
            tone="action"
            onPress={() => setPlaces((prev) => (prev.length >= USUAL_PLACES_MAX ? prev : [...prev, '']))}
          />
        </View>
      ) : null}

      <FieldNote text={USUAL_PLACES_GATE_NOTE} testID="editor-usual-places-note" />
    </FieldEditorFrame>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.xs },
  fieldCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smMd,
    backgroundColor: colors.paperRaised,
    borderRadius: radii.card,
    paddingLeft: spacing.lgXl,
    paddingRight: spacing.smMd,
    paddingVertical: spacing.sm,
    ...shadows.sm,
  },
  input: { flex: 1, fontFamily: 'Outfit_400Regular', fontSize: 16, color: colors.ink, paddingVertical: spacing.smMd },
  remove: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row' },
});
