import { useState, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { TintedPlaceholder } from '../../photos/TintedPlaceholder';
import { CheckIcon, ChevronUpIcon, Dot, InfoIcon, PinIcon, Text } from '../../ui';
import { colors, radii, shadows, spacing } from '../../theme/tokens';
import { hereForLabel } from '../goalLabels';
import { HERE_FOR_FALLBACK, majorAndYear, tierWordFor, type ProfileViewData } from './model';

export interface ProfileHeroTestIDs {
  root?: string;
  photo?: string;
  placeholder?: string;
  hereNow?: string;
  online?: string;
  tier?: string;
  meta?: string;
  verified?: string;
  name?: string;
  statusLine?: string;
  goals?: string;
  tags?: string;
  notice?: string;
  expand?: string;
}

export interface ProfileHeroProps {
  /**
   * `bleed` — the profile screen: edge to edge, no radius, the action bar
   * floats over its bottom (`bottomSpace` keeps the text clear of it).
   * `card` — `ProfileTile`'s hero size (the editor's Preview tab): the same
   * content inside a rounded, shadowed card, footer rendered inside.
   */
  frame: 'bleed' | 'card';
  data: Pick<
    ProfileViewData,
    'firstName' | 'verified' | 'hereNow' | 'isOnline' | 'tier' | 'majorLabel' | 'gradYear' | 'statusLine' | 'goals' | 'tagLabels'
  >;
  /** Fallback fill behind the photo. */
  tint: string;
  /** Single-photo fallback when no `photoSlot` is given. */
  photoUrl?: string | null;
  /** The photo layer — the profile screen's `PhotoPager`, or Preview's carousel. */
  photoSlot?: ReactNode;
  /** Height above the top row (the safe-area inset on the profile screen). */
  topInset?: number;
  topLeft?: ReactNode;
  topRight?: ReactNode;
  /** Rendered right under the name block (the old identity row slot; kept for `ProfileTile` callers). */
  identitySlot?: ReactNode;
  /** The sparse-profile notice box (`05-profile-sparse.png`). */
  notice?: string | null;
  /** Shows the round chevron-up button that scrolls down to the detail. */
  onExpand?: () => void;
  /** `card` frame only: the say-hi/message row, rendered inside the card. */
  footer?: ReactNode;
  /** `card` frame, Preview only: the footer at 40% and untouchable. */
  disabledActions?: boolean;
  /** `bleed` frame: space kept clear at the bottom for the floating action bar. */
  bottomSpace?: number;
  /** `bleed` frame: the hero's height (a full screen). */
  height?: number;
  testIDs?: ProfileHeroTestIDs;
}

/** The single-photo layer for callers without a pager (the grid's `photoUrl` shape). */
function SinglePhoto({ photoUrl, tint, testIDs }: { photoUrl?: string | null; tint: string; testIDs: ProfileHeroTestIDs }) {
  const [failed, setFailed] = useState(false);
  if (!photoUrl || failed) {
    return <TintedPlaceholder testID={testIDs.placeholder} tint={tint} style={styles.flatPlaceholder} />;
  }
  return <Image testID={testIDs.photo} source={{ uri: photoUrl }} style={styles.fill} onError={() => setFailed(true)} />;
}

/**
 * The profile hero (`docs/design/profile-redesign/01`, `02`, `05`): photo,
 * top scrim, bottom scrim, `here now` pill, big first name with the verified
 * check, the pin line (tier word · major and year), the status line, the
 * `here for …` chip and tag chips, and the round expand button. One
 * component for the profile screen (`bleed`) and `ProfileTile`'s hero size
 * (`card`, used by the editor's Preview), so the two cannot drift.
 */
export function ProfileHero({
  frame,
  data,
  tint,
  photoUrl,
  photoSlot,
  topInset = 0,
  topLeft,
  topRight,
  identitySlot,
  notice,
  onExpand,
  footer,
  disabledActions = false,
  bottomSpace = 0,
  height,
  testIDs = {},
}: ProfileHeroProps) {
  const tierWord = tierWordFor(data.tier);
  const rest = majorAndYear(data.majorLabel, data.gradYear);
  const showOnlineDot = !data.hereNow && !!data.isOnline;
  const hereFor = hereForLabel(data.goals ?? []) || HERE_FOR_FALLBACK;
  const tags = data.tagLabels ?? [];
  const bleed = frame === 'bleed';

  return (
    <View
      testID={testIDs.root}
      style={[
        styles.base,
        { backgroundColor: tint },
        bleed ? { height } : [styles.card, shadows.hero],
      ]}
    >
      <View style={StyleSheet.absoluteFill}>{photoSlot ?? <SinglePhoto photoUrl={photoUrl} tint={tint} testIDs={testIDs} />}</View>

      <View style={[styles.topScrim, { height: topInset + 110 }]} pointerEvents="none">
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="profileHeroTop" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colors.ink} stopOpacity={0.35} />
              <Stop offset="1" stopColor={colors.ink} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#profileHeroTop)" />
        </Svg>
      </View>

      <View style={styles.bottomScrim} pointerEvents="none">
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="profileHeroBottom" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colors.ink} stopOpacity={0} />
              <Stop offset="0.45" stopColor={colors.ink} stopOpacity={0.45} />
              <Stop offset="1" stopColor={colors.ink} stopOpacity={0.85} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#profileHeroBottom)" />
        </Svg>
      </View>

      {topLeft || topRight ? (
        <View style={[styles.topRow, { top: topInset + (bleed ? 26 : spacing.lgXl) }]} pointerEvents="box-none">
          {topLeft ?? <View />}
          {topRight ?? <View />}
        </View>
      ) : null}

      <View style={[styles.bottom, { paddingBottom: bleed ? bottomSpace + spacing.lgXl : spacing.xxl }]} pointerEvents="box-none">
        {data.hereNow ? (
          <View style={styles.hereNowPill} testID={testIDs.hereNow}>
            <Dot color={colors.signal} size={8} />
            <Text variant="labelLg" color={colors.ink}>
              here now
            </Text>
          </View>
        ) : null}

        <View style={styles.nameBlock}>
          <View style={styles.nameColumn}>
            <View style={styles.nameRow}>
              <Text
                variant="hero"
                color={colors.onDark}
                style={styles.name}
                numberOfLines={1}
                testID={testIDs.name}
                accessibilityRole="header"
              >
                {data.firstName}
              </Text>
              {data.verified ? (
                <View style={styles.verified} accessibilityLabel="verified student" testID={testIDs.verified}>
                  <CheckIcon size={14} color={colors.ink} />
                </View>
              ) : null}
              {showOnlineDot ? <Dot testID={testIDs.online} color={colors.success} size={9} /> : null}
            </View>

            {tierWord || rest ? (
              <View style={styles.metaRow} testID={testIDs.meta}>
                {tierWord ? <PinIcon size={14} color={colors.onDark} /> : null}
                <Text variant="bodyMedium" color={colors.onDark} style={styles.metaText} numberOfLines={1}>
                  {tierWord ? (
                    <Text variant="bodyMedium" color={colors.onDark} testID={testIDs.tier}>
                      {tierWord}
                    </Text>
                  ) : null}
                  {tierWord && rest ? ' · ' : ''}
                  {rest}
                </Text>
              </View>
            ) : null}
          </View>

          {onExpand ? (
            <Pressable
              testID={testIDs.expand}
              accessibilityRole="button"
              accessibilityLabel={`more about ${data.firstName}`}
              onPress={onExpand}
              style={({ pressed }) => [styles.expand, shadows.float, pressed && styles.pressed]}
            >
              <ChevronUpIcon size={22} color={colors.ink} />
            </Pressable>
          ) : null}
        </View>

        {identitySlot}

        {data.statusLine ? (
          <Text variant="bodyMedium" color={colors.onDark} style={styles.status} testID={testIDs.statusLine}>
            {data.statusLine}
          </Text>
        ) : null}

        {/* One wrapping row, so tag chips flow on after the goal chip
            (01-profile-top.png). The `tags` testID marks the row only when
            there are tags. */}
        <View style={styles.chips} testID={tags.length > 0 ? testIDs.tags : undefined}>
          <View style={styles.goalChip} testID={testIDs.goals}>
            <Text variant="labelLg" color={colors.ink} numberOfLines={1}>
              {hereFor}
            </Text>
          </View>
          {tags.map((label) => (
            <View key={label} style={styles.tagChip}>
              <Text variant="labelLg" color={colors.onDark} numberOfLines={1}>
                {label}
              </Text>
            </View>
          ))}
        </View>

        {notice ? (
          <View style={styles.notice} testID={testIDs.notice}>
            <InfoIcon size={18} color={colors.onDark} />
            <Text variant="micro" color={colors.onDark} style={styles.noticeText}>
              {notice}
            </Text>
          </View>
        ) : null}

        {!bleed && footer ? (
          <View
            style={disabledActions ? styles.footerDisabled : undefined}
            pointerEvents={disabledActions ? 'none' : 'auto'}
            accessibilityElementsHidden={disabledActions}
            importantForAccessibility={disabledActions ? 'no-hide-descendants' : 'auto'}
          >
            {footer}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** The frosted round icon button that sits on a photo (back, overflow). */
export function PhotoIconButton({
  onPress,
  accessibilityLabel,
  children,
  testID,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  children: ReactNode;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.photoButton, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { width: '100%', overflow: 'hidden', position: 'relative' },
  card: { flex: 1, borderRadius: radii.hero },
  fill: { width: '100%', height: '100%' },
  flatPlaceholder: { borderRadius: 0 },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottomScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '62%' },
  topRow: {
    position: 'absolute',
    left: spacing.lgXl,
    right: spacing.lgXl,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.xlXxl, gap: spacing.mdLg },
  hereNowPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smMd,
    backgroundColor: colors.paper,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.smMd,
  },
  nameBlock: { flexDirection: 'row', alignItems: 'center', gap: spacing.mdLg },
  nameColumn: { flex: 1, gap: spacing.sm },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  name: { fontSize: 48, lineHeight: 52, letterSpacing: -1.4, flexShrink: 1 },
  verified: {
    width: 28,
    height: 28,
    borderRadius: radii.circle,
    backgroundColor: colors.sage,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  metaText: { opacity: 0.92, flexShrink: 1 },
  expand: {
    width: 52,
    height: 52,
    borderRadius: radii.circle,
    backgroundColor: colors.onPhotoLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  status: { fontSize: 16, lineHeight: 22 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.smMd, alignItems: 'center' },
  goalChip: {
    backgroundColor: colors.paper,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.smMd,
    maxWidth: '100%',
  },
  tagChip: {
    backgroundColor: colors.onPhotoChip,
    borderWidth: 1,
    borderColor: colors.onPhotoChipBorder,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 1,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.onPhotoButton,
    borderWidth: 1,
    borderColor: colors.onPhotoChip,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.mdLg,
  },
  noticeText: { flex: 1, fontSize: 14, lineHeight: 20 },
  footerDisabled: { opacity: 0.4 },
  photoButton: {
    width: 44,
    height: 44,
    borderRadius: radii.circle,
    backgroundColor: colors.onPhotoButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.8 },
});
