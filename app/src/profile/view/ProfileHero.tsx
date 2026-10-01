import { useId, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { TintedPlaceholder } from '../../photos/TintedPlaceholder';
import { CheckIcon, ChevronUpIcon, Dot, InfoIcon, PinIcon, Text } from '../../ui';
import { displayName } from '../../ui/displayName';
import { colors, radii, shadows, spacing } from '../../theme/tokens';
import { hereForChipLabel } from '../goalLabels';
import { HERE_FOR_FALLBACK, metaParts, type ProfileViewData } from './model';
import { StorageImage } from '../../ui/StorageImage';

export interface ProfileHeroTestIDs {
  root?: string;
  photo?: string;
  placeholder?: string;
  hereNow?: string;
  online?: string;
  tier?: string;
  /** The place line, when it stands in for the tier word. */
  place?: string;
  meta?: string;
  verified?: string;
  name?: string;
  statusLine?: string;
  goals?: string;
  tags?: string;
  notice?: string;
  expand?: string;
  topScrim?: string;
  bottomScrim?: string;
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
  > & { placeLine?: string | null };
  /** Fallback fill behind the photo. */
  tint: string;
  /** Single-photo fallback when no `photoSlot` is given. */
  photoUrl?: string | null;
  /** The photo layer — the profile screen's `PhotoPager`, or Preview's carousel. */
  photoSlot?: ReactNode;
  /** Height above the top row (the safe-area inset on the profile screen). */
  topInset?: number;
  /**
   * `bleed` frame: extra space either side of the buttons and text, so they
   * stay in the centred content column on a wide screen while the photo and
   * scrims still fill the whole width. 0 on a phone.
   */
  sideInset?: number;
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
  /** `bleed` frame: the hero's height (the screen's measured height). */
  height?: number;
  /** `bleed` frame: the hero's width, used until its own layout is measured. */
  width?: number;
  testIDs?: ProfileHeroTestIDs;
}

/** The bottom scrim never covers less than this share of the hero (the artboards' fade). */
export const BOTTOM_SCRIM_SHARE = 0.62;
/** Clear fade kept above the overlaid text, so the text never sits on the scrim's faint top. */
export const BOTTOM_SCRIM_FADE = 120;
/** The top scrim reaches this far below the status bar. */
export const TOP_SCRIM_BELOW_INSET = 110;

/**
 * The two scrims' heights, in points, for a hero `heroHeight` tall whose
 * bottom block (here now … chips, plus the space kept for the action bar)
 * is `contentHeight` tall. The bottom scrim is anchored to the hero's bottom
 * edge and reaches at least `BOTTOM_SCRIM_SHARE` of the way up, or higher
 * when the text needs it; neither is ever taller than the hero.
 */
export function heroScrimHeights(heroHeight: number, topInset: number, contentHeight: number): { top: number; bottom: number } {
  const h = Math.max(0, Math.round(heroHeight));
  return {
    top: Math.min(h, Math.round(topInset + TOP_SCRIM_BELOW_INSET)),
    bottom: Math.min(h, Math.max(Math.round(h * BOTTOM_SCRIM_SHARE), Math.ceil(contentHeight) + BOTTOM_SCRIM_FADE)),
  };
}

type ScrimStop = { offset: number; opacity: number };
const TOP_STOPS: ScrimStop[] = [
  { offset: 0, opacity: 0.35 },
  { offset: 1, opacity: 0 },
];
const BOTTOM_STOPS: ScrimStop[] = [
  { offset: 0, opacity: 0 },
  { offset: 0.45, opacity: 0.45 },
  { offset: 1, opacity: 0.85 },
];

/**
 * One scrim: an ink gradient in an absolutely placed box of a known size.
 * The SVG is given plain numbers for its size, never percentages, and is
 * remounted whenever that size changes. On Android a percentage-sized `Svg`
 * kept the gradient it drew on the first frame (sized from the window,
 * which leaves out the system bars) after the hero grew to the full screen,
 * so the scrim stopped short of the hero's bottom edge with a hard line and
 * bare photo under it.
 */
function Scrim({
  width,
  height,
  stops,
  style,
  testID,
}: {
  width: number;
  height: number;
  stops: ScrimStop[];
  style: object;
  testID?: string;
}) {
  // Unique per instance: on the web every SVG shares one document, and two
  // heroes (a screen kept mounted under the next) must not share a gradient.
  const id = `scrim${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const w = Math.round(width);
  const h = Math.round(height);
  return (
    <View style={[style, { height: h }]} pointerEvents="none" testID={testID}>
      {w > 0 && h > 0 ? (
        <Svg key={`${w}x${h}`} width={w} height={h} testID={testID ? `${testID}-svg` : undefined}>
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              {stops.map((stop) => (
                <Stop key={stop.offset} offset={stop.offset} stopColor={colors.ink} stopOpacity={stop.opacity} />
              ))}
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={w} height={h} fill={`url(#${id})`} />
        </Svg>
      ) : null}
    </View>
  );
}

/** The single-photo layer for callers without a pager (the grid's `photoUrl` shape). */
function SinglePhoto({ photoUrl, tint, testIDs }: { photoUrl?: string | null; tint: string; testIDs: ProfileHeroTestIDs }) {
  const [failed, setFailed] = useState(false);
  if (!photoUrl || failed) {
    return <TintedPlaceholder testID={testIDs.placeholder} tint={tint} style={styles.flatPlaceholder} />;
  }
  return (
    <StorageImage testID={testIDs.photo} uri={photoUrl} tint={tint} style={styles.fill} onError={() => setFailed(true)} />
  );
}

/**
 * The profile hero (`docs/design/profile-redesign/01`, `02`, `05`): photo,
 * top scrim, bottom scrim, `here now` pill, big first name with the verified
 * check, the pin line (place line or tier word · major and year), the status line, the
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
  sideInset = 0,
  topLeft,
  topRight,
  identitySlot,
  notice,
  onExpand,
  footer,
  disabledActions = false,
  bottomSpace = 0,
  height,
  width,
  testIDs = {},
}: ProfileHeroProps) {
  // The place line replaces the tier word (`library, 2nd floor · nursing
  // '27`) and never shows without one: away has neither.
  const { tierWord, place, lead, rest } = metaParts(data);
  const showOnlineDot = !data.hereNow && !!data.isOnline;
  const hereFor = hereForChipLabel(data.goals ?? []) || HERE_FOR_FALLBACK;
  const tags = data.tagLabels ?? [];
  const bleed = frame === 'bleed';
  const side = bleed ? sideInset : 0;
  const name = displayName(data.firstName);

  // The hero's own size (the `card` frame has no height prop, and both need
  // the width for the scrims) and the bottom block's height, so the bottom
  // scrim always reaches above the text however much of it there is.
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [contentHeight, setContentHeight] = useState(0);
  const heroHeight = bleed && height !== undefined ? height : (size?.height ?? 0);
  const heroWidth = size?.width ?? (bleed ? (width ?? 0) : 0);
  const scrims = heroScrimHeights(heroHeight, topInset, contentHeight);

  function onHeroLayout(event: LayoutChangeEvent) {
    const { width: w, height: h } = event.nativeEvent.layout;
    if (w > 0 && h > 0 && (w !== size?.width || h !== size?.height)) setSize({ width: w, height: h });
  }

  function onContentLayout(event: LayoutChangeEvent) {
    const h = Math.ceil(event.nativeEvent.layout.height);
    if (h > 0 && h !== contentHeight) setContentHeight(h);
  }

  return (
    <View
      testID={testIDs.root}
      onLayout={onHeroLayout}
      style={[
        styles.base,
        { backgroundColor: tint },
        bleed ? { height } : [styles.card, shadows.hero],
      ]}
    >
      <View style={StyleSheet.absoluteFill}>{photoSlot ?? <SinglePhoto photoUrl={photoUrl} tint={tint} testIDs={testIDs} />}</View>

      {/* Under the status bar, so its icons stay readable on a light photo. */}
      <Scrim width={heroWidth} height={scrims.top} stops={TOP_STOPS} style={styles.topScrim} testID={testIDs.topScrim} />
      {/* Anchored to the hero's bottom edge, behind the text and the action bar. */}
      <Scrim
        width={heroWidth}
        height={scrims.bottom}
        stops={BOTTOM_STOPS}
        style={styles.bottomScrim}
        testID={testIDs.bottomScrim}
      />

      {topLeft || topRight ? (
        <View
          style={[styles.topRow, { top: topInset + (bleed ? 26 : spacing.lgXl), left: spacing.lgXl + side, right: spacing.lgXl + side }]}
          pointerEvents="box-none"
        >
          {topLeft ?? <View />}
          {topRight ?? <View />}
        </View>
      ) : null}

      <View
        onLayout={onContentLayout}
        style={[
          styles.bottom,
          { paddingBottom: bleed ? bottomSpace + spacing.lgXl : spacing.xxl, paddingHorizontal: spacing.xlXxl + side },
        ]}
        pointerEvents="box-none"
      >
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
                {name}
              </Text>
              {data.verified ? (
                <View style={styles.verified} accessibilityLabel="verified student" testID={testIDs.verified}>
                  <CheckIcon size={14} color={colors.ink} />
                </View>
              ) : null}
              {showOnlineDot ? <Dot testID={testIDs.online} color={colors.success} size={9} /> : null}
            </View>

            {lead || rest ? (
              <View style={styles.metaRow} testID={testIDs.meta}>
                {lead ? <PinIcon size={14} color={colors.onDark} /> : null}
                <Text
                  variant="bodyMedium"
                  color={colors.onDark}
                  style={styles.metaText}
                  numberOfLines={1}
                  // With a place line the tier word is not drawn; a screen
                  // reader still hears it.
                  accessibilityLabel={place ? [place, tierWord, rest].filter(Boolean).join(', ') : undefined}
                >
                  {place ? (
                    <Text variant="bodyMedium" color={colors.onDark} testID={testIDs.place}>
                      {place}
                    </Text>
                  ) : tierWord ? (
                    <Text variant="bodyMedium" color={colors.onDark} testID={testIDs.tier}>
                      {tierWord}
                    </Text>
                  ) : null}
                  {lead && rest ? ' · ' : ''}
                  {rest}
                </Text>
              </View>
            ) : null}
          </View>

          {onExpand ? (
            <Pressable
              testID={testIDs.expand}
              accessibilityRole="button"
              accessibilityLabel={`more about ${name}`}
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
  bottomScrim: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  topRow: {
    position: 'absolute',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: spacing.mdLg },
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
