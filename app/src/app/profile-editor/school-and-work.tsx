import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { listPrograms } from '../../api/about';
import { FieldEditorFrame } from '../../me/editor/FieldEditorFrame';
import { ProgramPickerSheet } from '../../me/editor/ProgramPickerSheet';
import { useProfileEditorDraftContext } from '../../me/editor/ProfileEditorDraftContext';
import { useDiscardGuard } from '../../me/editor/useDiscardGuard';
import { queryKeys } from '../../me/queryKeys';
import {
  enumLabel,
  graduatingYearOptions,
  GRADUATING_TERMS,
  JOB_TITLE_MAX_LENGTH,
  sameAbout,
  toggleWorkHours,
  WORK_HOURS,
  WORK_HOURS_MAX,
  WORK_TYPES,
  type AboutSection,
  type ProgramRef,
} from '../../profile/about';
import { WORD_FILTER_COPY } from '../../profile/fields';
import { ChevronRightIcon, Chip, ChipGroup, Input, RowCard, SectionLabel, Text, Toggle } from '../../ui';
import { colors, spacing } from '../../theme/tokens';

/**
 * `/profile-editor/school-and-work`: the about section's editor (migration
 * 0018, decision 94; `docs/design/tags-about/contract.md` §4). Major and
 * minor from the campus's program list (the minor must differ from the
 * major and can be cleared), graduating term and year (this year .. +8) or
 * `not sure yet` (mutually exclusive), work type (one of 21), a job title
 * (48 characters) and up to three work hours (part time and full time
 * exclude each other).
 *
 * Draft-model like the other pushed editors: `save` writes into the
 * editor's draft and pops; the editor's `done` sends only what changed
 * through `set_my_about`. Stage and "what's next" are not built (owner
 * ruling 1). Nothing here carries completion weight.
 *
 * The pronouns and orientation screen stays at `/profile-editor/about`,
 * so its existing links and redirects keep working.
 */
export default function SchoolAndWorkScreen() {
  const draftState = useProfileEditorDraftContext();
  const initial = draftState.draft.about;
  const [about, setAbout] = useState<AboutSection>(initial);
  const [sheet, setSheet] = useState<'major' | 'minor' | null>(null);
  const guard = useDiscardGuard(!sameAbout(initial, about));

  const programsQuery = useQuery({ queryKey: queryKeys.me.programs, queryFn: listPrograms });
  const programs: ProgramRef[] = (programsQuery.data ?? []).map(({ id, label }) => ({ id, label }));
  const years = graduatingYearOptions(new Date(), initial.graduatingYear);

  const savedError = draftState.fieldErrors.about ?? null;
  const titleError = savedError === WORD_FILTER_COPY && about.jobTitle === initial.jobTitle ? savedError : null;
  const notWorking = about.workType === 'not_working_right_now';

  function update(patch: Partial<AboutSection>) {
    setAbout((prev) => ({ ...prev, ...patch }));
  }

  function save() {
    draftState.setAbout({ ...about, jobTitle: about.jobTitle?.trim() ? about.jobTitle.trim() : null });
    guard.leave();
  }

  return (
    <FieldEditorFrame
      testID="editor-school-work"
      title="school and work"
      intro="shows in the about card on your profile. fill in as much or as little as you want."
      onCancel={guard.requestClose}
      onSave={save}
      saveDisabled={!!about.graduatingTerm && about.graduatingYear === null}
      error={savedError && !titleError ? savedError : null}
      overlay={
        sheet ? (
          <ProgramPickerSheet
            testID={`editor-school-work-${sheet}-sheet`}
            title={sheet === 'major' ? 'your major' : 'your minor'}
            programs={programs}
            selectedId={(sheet === 'major' ? about.major?.id : about.minor?.id) ?? null}
            excludeId={sheet === 'minor' ? (about.major?.id ?? null) : null}
            clearLabel={sheet === 'major' ? 'no major' : 'no minor'}
            onPick={(program) => {
              if (sheet === 'major') {
                // A cleared major takes the minor with it; a major equal to
                // the minor clears the minor (the server does the same).
                const keepMinor = program && about.minor && about.minor.id !== program.id ? about.minor : null;
                update({ major: program, minor: keepMinor });
              } else {
                update({ minor: program });
              }
              setSheet(null);
            }}
            onDismiss={() => setSheet(null)}
          />
        ) : null
      }
    >
      <View style={styles.group}>
        <SectionLabel label="school" />
        <RowCard style={styles.cardInset}>
          <PickerRow
            testID="editor-school-work-major"
            title="major"
            value={about.major?.label ?? null}
            placeholder={programsQuery.isError ? "the list didn't load" : 'pick your major'}
            onPress={() => setSheet('major')}
            disabled={programs.length === 0}
          />
          <PickerRow
            testID="editor-school-work-minor"
            title="minor"
            value={about.minor?.label ?? null}
            placeholder={about.major ? 'optional' : 'pick a major first'}
            onPress={() => setSheet('minor')}
            disabled={!about.major || programs.length === 0}
          />
        </RowCard>
      </View>

      <View style={styles.group}>
        <SectionLabel label="graduating" />
        <RowCard style={styles.cardInset}>
          <View style={styles.cardBody}>
            <View style={styles.toggleRow}>
              <Text variant="labelLg" style={styles.flex}>
                not sure yet
              </Text>
              <Toggle
                testID="editor-school-work-unsure"
                accessibilityLabel="not sure yet"
                value={about.graduatingUnsure}
                onValueChange={(unsure) =>
                  update(unsure ? { graduatingUnsure: true, graduatingYear: null, graduatingTerm: null } : { graduatingUnsure: false })
                }
              />
            </View>
            {about.graduatingUnsure ? null : (
              <>
                <Text variant="micro" color={colors.inkSoft}>
                  term
                </Text>
                <ChipGroup
                  testID="editor-school-work-term"
                  mode="one"
                  options={GRADUATING_TERMS.map((term) => ({ value: term, label: term }))}
                  value={about.graduatingTerm ? [about.graduatingTerm] : []}
                  onChange={(next) => update({ graduatingTerm: (next[0] as AboutSection['graduatingTerm']) ?? null })}
                />
                <Text variant="micro" color={colors.inkSoft}>
                  year
                </Text>
                <ChipGroup
                  testID="editor-school-work-year"
                  mode="one"
                  options={years.map((year) => ({ value: String(year), label: String(year) }))}
                  value={about.graduatingYear ? [String(about.graduatingYear)] : []}
                  onChange={(next) => {
                    const year = next[0] ? Number(next[0]) : null;
                    // Clearing the year clears the term (a term needs a year).
                    update(year === null ? { graduatingYear: null, graduatingTerm: null } : { graduatingYear: year });
                  }}
                />
                {about.graduatingTerm && about.graduatingYear === null ? (
                  <Text variant="micro" color={colors.inkSoft} testID="editor-school-work-term-needs-year">
                    pick a year to go with the term.
                  </Text>
                ) : null}
              </>
            )}
          </View>
        </RowCard>
      </View>

      <View style={styles.group}>
        <SectionLabel label="work" />
        <RowCard style={styles.cardInset}>
          <View style={styles.cardBody}>
            <ChipGroup
              testID="editor-school-work-type"
              mode="one"
              options={WORK_TYPES.map((type) => ({ value: type, label: enumLabel(type) }))}
              value={about.workType ? [about.workType] : []}
              onChange={(next) => {
                const type = (next[0] as AboutSection['workType']) ?? null;
                update(type === 'not_working_right_now' ? { workType: type, workHours: [] } : { workType: type });
              }}
            />
            <Input
              testID="editor-school-work-title"
              label="job title"
              surface="card"
              value={about.jobTitle ?? ''}
              onChangeText={(text) => update({ jobTitle: text })}
              placeholder="for example, barista at a place downtown"
              maxLength={JOB_TITLE_MAX_LENGTH}
              error={titleError ?? undefined}
              helper={`${(about.jobTitle ?? '').length} of ${JOB_TITLE_MAX_LENGTH}`}
            />
            {notWorking ? null : (
              <>
                <Text variant="micro" color={colors.inkSoft}>
                  {`hours, up to ${WORK_HOURS_MAX}`}
                </Text>
                <View style={styles.chips}>
                  {WORK_HOURS.map((hour) => {
                    const selected = about.workHours.includes(hour);
                    const full = !selected && about.workHours.length >= WORK_HOURS_MAX && !swapsAPart(about.workHours, hour);
                    return (
                      <Chip
                        key={hour}
                        testID={`editor-school-work-hours-${hour}`}
                        label={enumLabel(hour)}
                        tone="tint"
                        selected={selected}
                        disabled={full}
                        onPress={() => update({ workHours: toggleWorkHours(about.workHours, hour) })}
                      />
                    );
                  })}
                </View>
              </>
            )}
          </View>
        </RowCard>
      </View>
    </FieldEditorFrame>
  );
}

/** Picking part time with full time held (or the reverse) swaps them, so it is never blocked by the cap. */
function swapsAPart(current: AboutSection['workHours'], hour: AboutSection['workHours'][number]): boolean {
  return (hour === 'part_time' && current.includes('full_time')) || (hour === 'full_time' && current.includes('part_time'));
}

function PickerRow({
  title,
  value,
  placeholder,
  onPress,
  disabled,
  testID,
}: {
  title: string;
  value: string | null;
  placeholder: string;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={value ? `${title}, ${value}` : `${title}, ${placeholder}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.pickerRow, pressed && styles.pressed]}
    >
      <Text variant="labelLg" style={styles.pickerTitle}>
        {title}
      </Text>
      <Text variant="bodyMedium" color={value ? colors.ink : colors.inkSoft} numberOfLines={1} style={styles.flex}>
        {value ?? placeholder}
      </Text>
      <ChevronRightIcon size={18} color={disabled ? colors.inkDisabled : colors.inkFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  group: { gap: spacing.smMd },
  cardInset: { paddingHorizontal: spacing.lgXl },
  cardBody: { paddingVertical: spacing.lgXl, gap: spacing.mdLg },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.mdLg, minHeight: 44 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.smMd },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.mdLg, minHeight: 52, paddingVertical: spacing.mdLg },
  pickerTitle: { width: 56 },
  pressed: { opacity: 0.6 },
});
