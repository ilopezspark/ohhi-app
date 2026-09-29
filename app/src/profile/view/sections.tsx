import { useState, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { TintedPlaceholder } from '../../photos/TintedPlaceholder';
import { tintForPhoto } from '../../photos/tint';
import { CapIcon, ChatIcon, CheckIcon, Chip, FlagIcon, PeopleIcon, PersonIcon, ShieldIcon, TagIcon, Text } from '../../ui';
import { colors, radii, shadows, spacing } from '../../theme/tokens';
import { classOf, type ProfileViewData } from './model';

/**
 * The profile's detail list (`03-profile-scrolled.png`, `04-profile-full*.png`)
 * as a plain ordered list of sections. Each section renders only when it has
 * data. Phase 1 builds: what you two share, the basics, photo 2, into, photo
 * 3, and the footer. The artboards also draw prompt cards, `around campus`
 * and classes; none of those have data yet, so they are not built, but each
 * would slot in here as one more `{ key, render }` entry at its artboard
 * position (see the `later:` markers in `detailSections`).
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
}

export function detailSections(data: ProfileViewData, { prefix, onReportOrBlock }: DetailSectionOptions): DetailSection[] {
  const sections: DetailSection[] = [];
  const photo = (position: number) => {
    const path = data.photoPaths[position];
    if (!path) return;
    sections.push({
      key: `photo-${position}`,
      render: () => (
        <PhotoCard
          userId={data.userId}
          position={position}
          url={data.photoUrls[path]}
          firstName={data.firstName}
          testID={`${prefix}-photo-card-${position}`}
        />
      ),
    });
  };

  if (data.sharedLines.length > 0) {
    sections.push({ key: 'shared', render: () => <SharedCard lines={data.sharedLines} testID={`${prefix}-shared`} /> });
  }

  const basics = basicsRows(data, prefix);
  if (basics.length > 0) {
    sections.push({ key: 'basics', render: () => <BasicsCard rows={basics} testID={`${prefix}-basics`} /> });
  }

  photo(1);
  // later: the first prompt card goes here.

  if (data.tagLabels.length > 0) {
    sections.push({ key: 'into', render: () => <IntoCard tags={data.tagLabels} testID={`${prefix}-into`} /> });
  }

  photo(2);
  // later: the second prompt card, then `around campus` (places and classes).

  sections.push({
    key: 'footer',
    render: () => (
      <ProfileFooter
        firstName={data.firstName}
        verified={data.verified}
        campusShort={data.campusShort}
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

/** The basics card's rows: major and year, pronouns, orientation. Transfer plans, commute and year-in-school are not scoped. */
export function basicsRows(data: ProfileViewData, prefix: string): BasicsRow[] {
  const rows: BasicsRow[] = [];
  const year = classOf(data.gradYear);
  if (data.majorLabel || year) {
    rows.push({
      key: 'major',
      icon: <CapIcon size={20} color={colors.muted} />,
      primary: data.majorLabel ?? (year as string),
      secondary: data.majorLabel ? year : null,
      testID: `${prefix}-basics-major`,
    });
  }
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

export function BasicsCard({ rows, testID }: { rows: BasicsRow[]; testID?: string }) {
  return (
    <View style={[styles.card, shadows.card]} testID={testID}>
      <CardHeader icon={<PersonIcon size={16} color={colors.muted} />} label="the basics" />
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

export function ProfileFooter({
  firstName,
  verified,
  campusShort,
  onReportOrBlock,
  prefix,
}: {
  firstName: string;
  verified: boolean;
  campusShort: string | null;
  onReportOrBlock?: () => void;
  prefix: string;
}) {
  return (
    <View style={styles.footer} testID={`${prefix}-footer`}>
      {verified ? (
        <View style={styles.footerRow}>
          <ShieldIcon size={16} color={colors.inkSoft} />
          <Text variant="micro" color={colors.inkSoft} testID={`${prefix}-footer-verified`}>
            {campusShort ? `verified student at ${campusShort}` : 'verified student'}
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
  photoCard: {
    width: '100%',
    aspectRatio: 537 / 450,
    borderRadius: radii.card,
    overflow: 'hidden',
    backgroundColor: colors.tint,
  },
  photo: { width: '100%', height: '100%' },
  photoPlaceholder: { borderRadius: 0 },
  footer: { gap: spacing.mdLg, paddingHorizontal: spacing.xs, paddingTop: spacing.xs },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.smMd },
  reportRow: { minHeight: 44, alignSelf: 'flex-start' },
  pressed: { opacity: 0.7 },
});
