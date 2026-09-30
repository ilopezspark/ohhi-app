import { useState, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { TintedPlaceholder } from '../../photos/TintedPlaceholder';
import { tintForPhoto } from '../../photos/tint';
import {
  CapIcon,
  ChatIcon,
  CheckIcon,
  Chip,
  FlagIcon,
  LockIcon,
  PeopleIcon,
  PersonIcon,
  PinIcon,
  ShieldIcon,
  TagIcon,
  Text,
} from '../../ui';
import { colors, radii, shadows, spacing } from '../../theme/tokens';
import { displayName } from '../../ui/displayName';
import { GATED_NOTE, joinedMonthLabel } from '../fields';
import { type ProfilePrompt, type ProfileViewData } from './model';
import { aboutRows, type AboutRowKey } from '../about';
import { BriefcaseIcon, CalendarIcon } from '../../ui/icons/AboutIcons';

/**
 * The profile's detail list (`03-profile-scrolled.png`, `04-profile-full*.png`)
 * as a plain ordered list of sections, in the brief's section order: what
 * you two share, about (migration 0018: major, graduating, work), the basics
 * (pronouns and orientation, when public), photo 2, a prompt, into, photo 3, the next
 * prompt(s), around campus, the footer. Each section renders only when it
 * has data; a section with nothing to show is left out, not drawn empty.
 * Classes, commute and year-in-school rows are not built (ruling 1).
 */
export interface DetailSection {
  key: string;
  render: () => ReactNode;
}

export interface DetailSectionOptions {
  /** testID prefix, e.g. `profile`. */
  prefix: string;
  /** Opens the report/block sheet. Omitted (e.g. in a preview) hides the link. */
  onReportOrBlock?: () => void;
  /**
   * The owner looking at their own profile (the editor's Preview). Gated
   * content (usual places, gated prompts) is shown to them with a note that
   * others see it only once a hi has been answered.
   */
  preview?: boolean;
  /** "Now" for the footer's month label (tests). */
  now?: Date;
}

/**
 * Where the prompt cards go among the cards that separate them (photo 2,
 * into, photo 3). `isPhoto[i]` describes block i; the result has one entry
 * per gap: `[0]` is before the first block, `[i + 1]` is right after block i.
 *
 * The artboard pairs each prompt with the photo above it (photo 2 → first
 * answer, photo 3 → second), so gaps after photos are filled first, then
 * gaps after the other cards, then the gap before the first block. That keeps
 * two prompts from touching whenever there is anything to put between them:
 * three answers and three photos read photo, prompt, into, prompt, photo,
 * prompt. Prompts that still have no gap (more answers than separators) go
 * at the end, in order. Answers always stay in the owner's order.
 */
export function placePrompts(isPhoto: boolean[], count: number): number[][] {
  const gaps: number[][] = Array.from({ length: isPhoto.length + 1 }, () => []);
  const priority = [
    ...isPhoto.flatMap((photo, i) => (photo ? [i + 1] : [])),
    ...isPhoto.flatMap((photo, i) => (photo ? [] : [i + 1])),
    0,
  ];
  const chosen = priority.slice(0, count).sort((a, b) => a - b);
  chosen.forEach((gap, i) => gaps[gap].push(i));
  for (let i = chosen.length; i < count; i++) gaps[isPhoto.length].push(i);
  return gaps;
}

export function detailSections(
  data: ProfileViewData,
  { prefix, onReportOrBlock, preview = false, now }: DetailSectionOptions
): DetailSection[] {
  const sections: DetailSection[] = [];
  const name = displayName(data.firstName);

  if (data.sharedLines.length > 0) {
    sections.push({ key: 'shared', render: () => <SharedCard lines={data.sharedLines} testID={`${prefix}-shared`} /> });
  }

  // Migration 0018: the about card sits above the basics. Rows with no
  // value are left out, and with none the card is not drawn at all.
  const about = aboutCardRows(data, prefix);
  if (about.length > 0) {
    sections.push({ key: 'about', render: () => <BasicsCard title="about" rows={about} testID={`${prefix}-about`} /> });
  }

  const basics = basicsRows(data, prefix);
  if (basics.length > 0) {
    sections.push({ key: 'basics', render: () => <BasicsCard rows={basics} testID={`${prefix}-basics`} /> });
  }

  // The cards the prompts are spread between: photo 2, into, photo 3.
  const blocks: { isPhoto: boolean; section: DetailSection }[] = [];
  const photo = (position: number) => {
    const path = data.photoPaths[position];
    if (!path) return;
    blocks.push({
      isPhoto: true,
      section: {
        key: `photo-${position}`,
        render: () => (
          <PhotoCard
            userId={data.userId}
            position={position}
            url={data.photoUrls[path]}
            firstName={name}
            testID={`${prefix}-photo-card-${position}`}
          />
        ),
      },
    });
  };
  photo(1);
  if (data.tagLabels.length > 0) {
    blocks.push({
      isPhoto: false,
      section: { key: 'into', render: () => <IntoCard tags={data.tagLabels} testID={`${prefix}-into`} /> },
    });
  }
  photo(2);

  const promptSection = (index: number): DetailSection => {
    const prompt = data.prompts[index];
    return {
      key: `prompt-${prompt.promptId}`,
      render: () => (
        <PromptCard prompt={prompt} note={preview && prompt.gated ? GATED_NOTE : null} testID={`${prefix}-prompt-${index}`} />
      ),
    };
  };
  const gaps = placePrompts(
    blocks.map((block) => block.isPhoto),
    data.prompts.length
  );
  gaps.forEach((promptIndexes, gap) => {
    promptIndexes.forEach((index) => sections.push(promptSection(index)));
    if (gap < blocks.length) sections.push(blocks[gap].section);
  });

  // Null before the gate and when none are set, and the two must look the
  // same: no hint either way, so nothing at all is drawn for null.
  if (data.usualPlaces && data.usualPlaces.length > 0) {
    const places = data.usualPlaces;
    sections.push({
      key: 'around-campus',
      render: () => (
        <AroundCampusCard
          places={places}
          firstName={name}
          note={preview ? GATED_NOTE : null}
          testID={`${prefix}-around-campus`}
        />
      ),
    });
  }

  sections.push({
    key: 'footer',
    render: () => (
      <ProfileFooter
        firstName={name}
        verified={data.verified}
        campusShort={data.campusShort}
        joinedMonth={data.joinedMonth}
        now={now}
        onReportOrBlock={onReportOrBlock}
        prefix={prefix}
      />
    ),
  });

  return sections;
}

// ---------------------------------------------------------------------------

function CardHeader({ icon, label, color = colors.muted }: { icon: ReactNode; label: string; color?: string }) {
  return (
    <View style={styles.header} accessibilityRole="header">
      {icon}
      <Text variant="sectionLabel" color={color}>
        {label}
      </Text>
    </View>
  );
}

export function SharedCard({ lines, testID }: { lines: string[]; testID?: string }) {
  return (
    <View style={styles.shared} testID={testID}>
      <CardHeader icon={<PeopleIcon size={18} color={colors.sageInk} />} label="what you two share" color={colors.sageInk} />
      <View style={styles.sharedList}>
        {lines.map((line) => (
          <View key={line} style={styles.sharedRow}>
            <View style={styles.sharedCheck}>
              <CheckIcon size={13} color={colors.ink} />
            </View>
            <Text variant="bodyStrong" style={styles.sharedText}>
              {line}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export interface BasicsRow {
  key: string;
  icon: ReactNode;
  primary: string;
  secondary?: string | null;
  testID?: string;
}

const ABOUT_ICONS: Record<AboutRowKey, ReactNode> = {
  major: <CapIcon size={20} color={colors.muted} />,
  graduating: <CalendarIcon size={20} color={colors.muted} />,
  work: <BriefcaseIcon size={20} color={colors.muted} />,
};

/**
 * The about card's rows (`docs/design/tags-about/contract.md` §4, as ruled):
 * major (minor as a sub-line), `graduating spring 2028` or `not sure yet`,
 * work type and job title (hours as a sub-line). A row with no value is left
 * out; there is never a placeholder.
 */
export function aboutCardRows(data: Pick<ProfileViewData, 'about'>, prefix: string): BasicsRow[] {
  return aboutRows(data.about).map((row) => ({
    key: row.key,
    icon: ABOUT_ICONS[row.key],
    primary: row.primary,
    secondary: row.secondary,
    testID: `${prefix}-about-${row.key}`,
  }));
}

/**
 * The basics card's rows: pronouns and orientation, each only when the
 * person made them public. The major and graduating year moved to the about
 * card (migration 0018), so nothing shows twice; with neither row the card
 * is not drawn.
 */
export function basicsRows(data: ProfileViewData, prefix: string): BasicsRow[] {
  const rows: BasicsRow[] = [];
  if (data.pronouns) {
    rows.push({
      key: 'pronouns',
      icon: <ChatIcon size={20} color={colors.muted} />,
      primary: data.pronouns,
      testID: `${prefix}-identity`,
    });
  }
  if (data.orientation.length > 0) {
    rows.push({
      key: 'orientation',
      icon: <PersonIcon size={20} color={colors.muted} />,
      primary: data.orientation.join(', '),
      secondary: 'orientation',
      testID: `${prefix}-identity-orientation`,
    });
  }
  return rows;
}

/** An icon-and-value card with hairline-separated rows: `the basics`, and the about card (`title="about"`). */
export function BasicsCard({ rows, title = 'the basics', testID }: { rows: BasicsRow[]; title?: string; testID?: string }) {
  return (
    <View style={[styles.card, shadows.card]} testID={testID}>
      <CardHeader icon={<PersonIcon size={16} color={colors.muted} />} label={title} />
      <View>
        {rows.map((row, i) => (
          <View key={row.key} style={[styles.basicsRow, i < rows.length - 1 && styles.divider]} testID={row.testID}>
            <View style={styles.basicsIcon}>{row.icon}</View>
            <View style={styles.basicsText}>
              <Text variant="bodyMedium" style={styles.basicsPrimary}>
                {row.primary}
              </Text>
              {row.secondary ? (
                <Text variant="micro" color={colors.inkSoft}>
                  {row.secondary}
                </Text>
              ) : null}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

export function IntoCard({ tags, testID }: { tags: string[]; testID?: string }) {
  return (
    <View style={[styles.card, shadows.card]} testID={testID}>
      <CardHeader icon={<TagIcon size={16} color={colors.muted} />} label="into" />
      <View style={styles.chips}>
        {tags.map((label) => (
          <Chip key={label} label={label} tone="tint" style={styles.intoChip} />
        ))}
      </View>
    </View>
  );
}

/** The small lock line under gated content in the owner's own preview. */
function GatedNote({ text, testID }: { text: string; testID?: string }) {
  return (
    <View style={styles.gatedNote} testID={testID}>
      <LockIcon size={14} color={colors.inkSoft} />
      <Text variant="micro" color={colors.inkSoft} style={styles.gatedNoteText}>
        {text}
      </Text>
    </View>
  );
}

/** `04-profile-full-part2.png`: the question small and grey, the answer large and bold. */
export function PromptCard({ prompt, note, testID }: { prompt: ProfilePrompt; note?: string | null; testID?: string }) {
  return (
    <View style={[styles.card, shadows.card]} testID={testID}>
      <Text variant="labelLg" color={colors.muted} testID={testID ? `${testID}-question` : undefined}>
        {prompt.question}
      </Text>
      <Text variant="titleLg" style={styles.promptAnswer} testID={testID ? `${testID}-answer` : undefined}>
        {prompt.answer}
      </Text>
      {note ? <GatedNote text={note} testID={testID ? `${testID}-note` : undefined} /> : null}
    </View>
  );
}

/**
 * `around campus` (`04-profile-full-part3.png`), usual places only: the
 * artboard's classes row is not built (ruling 1). The sub-line uses the
 * first name, never a pronoun: the app does not know anyone's pronouns for
 * copy, only as an opt-in field.
 */
export function AroundCampusCard({
  places,
  firstName,
  note,
  testID,
}: {
  places: string[];
  firstName: string;
  note?: string | null;
  testID?: string;
}) {
  return (
    <View style={[styles.card, shadows.card]} testID={testID}>
      <CardHeader icon={<PinIcon size={16} color={colors.muted} />} label="around campus" />
      <View style={styles.basicsRow}>
        <View style={styles.basicsIcon}>
          <PinIcon size={20} color={colors.muted} />
        </View>
        <View style={styles.basicsText}>
          <Text variant="bodyMedium" style={styles.basicsPrimary} testID={testID ? `${testID}-places` : undefined}>
            {places.join(', ')}
          </Text>
          <Text variant="micro" color={colors.inkSoft}>
            {`where ${firstName} usually ends up`}
          </Text>
        </View>
      </View>
      {note ? <GatedNote text={note} testID={testID ? `${testID}-note` : undefined} /> : null}
    </View>
  );
}

export function PhotoCard({
  userId,
  position,
  url,
  firstName,
  testID,
}: {
  userId: string;
  position: number;
  url?: string;
  firstName: string;
  testID?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <View style={styles.photoCard} testID={testID} accessible accessibilityRole="image" accessibilityLabel={`photo ${position + 1} of ${firstName}`}>
      {url && !failed ? (
        <Image source={{ uri: url }} style={styles.photo} resizeMode="cover" onError={() => setFailed(true)} />
      ) : (
        <TintedPlaceholder tint={tintForPhoto(userId, position)} style={styles.photoPlaceholder} />
      )}
    </View>
  );
}

/**
 * `verified student at CLC · on ohhi since january` — the join month only
 * (ruling 3: coarse, never a timestamp), with the year added when it is not
 * this year.
 */
export function footerLine({
  verified,
  campusShort,
  joinedMonth,
  now,
}: {
  verified: boolean;
  campusShort: string | null;
  joinedMonth: string | null;
  now?: Date;
}): string {
  const parts: string[] = [];
  if (verified) parts.push(campusShort ? `verified student at ${campusShort}` : 'verified student');
  const since = joinedMonthLabel(joinedMonth, now);
  if (since) parts.push(`on ohhi since ${since}`);
  return parts.join(' · ');
}

export function ProfileFooter({
  firstName,
  verified,
  campusShort,
  joinedMonth = null,
  now,
  onReportOrBlock,
  prefix,
}: {
  firstName: string;
  verified: boolean;
  campusShort: string | null;
  joinedMonth?: string | null;
  now?: Date;
  onReportOrBlock?: () => void;
  prefix: string;
}) {
  const line = footerLine({ verified, campusShort, joinedMonth, now });
  return (
    <View style={styles.footer} testID={`${prefix}-footer`}>
      {line ? (
        <View style={styles.footerRow}>
          <ShieldIcon size={16} color={colors.inkSoft} />
          <Text variant="micro" color={colors.inkSoft} style={styles.footerText} testID={`${prefix}-footer-verified`}>
            {line}
          </Text>
        </View>
      ) : null}
      {onReportOrBlock ? (
        <Pressable
          testID={`${prefix}-report-block`}
          accessibilityRole="button"
          accessibilityLabel={`report or block ${firstName}`}
          onPress={onReportOrBlock}
          style={({ pressed }) => [styles.footerRow, styles.reportRow, pressed && styles.pressed]}
        >
          <FlagIcon size={16} color={colors.danger} />
          <Text variant="labelLg" color={colors.danger}>
            {`report or block ${firstName}`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.smMd },
  shared: {
    backgroundColor: colors.sageSoft,
    borderWidth: 1,
    borderColor: colors.sage,
    borderRadius: radii.card,
    padding: spacing.xlXxl,
    gap: spacing.mdLg,
  },
  sharedList: { gap: spacing.md },
  sharedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.mdLg },
  sharedCheck: {
    width: 26,
    height: 26,
    borderRadius: radii.circle,
    backgroundColor: colors.sage,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sharedText: { flex: 1, fontSize: 17, lineHeight: 22 },
  card: {
    backgroundColor: colors.paperRaised,
    borderRadius: radii.card,
    padding: spacing.xlXxl,
    gap: spacing.mdLg,
  },
  basicsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.lg },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  basicsIcon: { width: 22, alignItems: 'center' },
  basicsText: { flex: 1, gap: 2 },
  basicsPrimary: { fontSize: 16, lineHeight: 21 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.smMd },
  intoChip: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  promptAnswer: { fontSize: 26, lineHeight: 31, letterSpacing: -0.4 },
  gatedNote: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  gatedNoteText: { flex: 1 },
  // Portrait (4:5), like the photos themselves and the grid tile: the
  // artboard's wider card cropped heads and feet off portrait photos.
  photoCard: {
    width: '100%',
    aspectRatio: 4 / 5,
    borderRadius: radii.card,
    overflow: 'hidden',
    backgroundColor: colors.tint,
  },
  photo: { width: '100%', height: '100%' },
  photoPlaceholder: { borderRadius: 0 },
  footer: { gap: spacing.mdLg, paddingHorizontal: spacing.xs, paddingTop: spacing.xs },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.smMd },
  footerText: { flexShrink: 1 },
  reportRow: { minHeight: 44, alignSelf: 'flex-start' },
  pressed: { opacity: 0.7 },
});
