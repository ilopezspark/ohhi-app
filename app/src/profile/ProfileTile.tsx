import { useState, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, View, type ImageStyle, type StyleProp } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { TintedPlaceholder } from '../photos/TintedPlaceholder';
import { Badge, CheckIcon, Dot, PinIcon, Text } from '../ui';
import { colors, radii, shadows, spacing } from '../theme/tokens';
import { hereForLabel } from './goalLabels';

export type ProfileTileSize = 'grid' | 'thumbnail' | 'hero';

export interface ProfileTileData {
  firstName: string;
  gradYear?: number | null;
  statusLine?: string | null;
  /** `PresenceTier`'s effective 3-value form (`'on_campus' | 'nearby' | 'away'`) — `src/grid/tierLabel.ts#tierWord` already collapses `'county'`/staleness to `'away'` server-side, and this only ever renders a word for the first two. */
  tier: 'on_campus' | 'nearby' | 'county' | 'away';
  hereNow?: boolean;
  isOnline?: boolean;
  verified?: boolean;
  photoUrl?: string | null;
  /** Fallback fill when `photoUrl` is missing/broken — see `photoSlot` below for the multi-photo case. */
  tint: string;
  /** Already-truncated/ordered tag chip labels (the grid's own `tag_labels` convention). */
  tagLabels?: string[];
  /** Already-mapped goal chip labels (`goalLabels.ts#goalLabel`) — `grid`/`thumbnail` never render these; `hero` joins them via `hereForLabel`. */
  goals?: string[];
  majorLabel?: string | null;
  campusShort?: string | null;
}

/**
 * Per-part testID overrides. Every existing call site (`GridTile.tsx`,
 * `profile/[id].tsx`) passes these explicitly so this refactor is a pure
 * render-through with **zero testID changes** — `grid-screen.test.tsx` and
 * `card-screen.test.tsx` pass unmodified. New call sites (the Me row,
 * Preview) can omit any of these; nothing internal depends on them being set.
 */
export interface ProfileTileTestIDs {
  root?: string;
  photo?: string;
  placeholder?: string;
  hereNow?: string;
  online?: string;
  tier?: string;
  verified?: string;
  name?: string;
  statusLine?: string;
  goals?: string;
  tags?: string;
}

export interface ProfileTileProps {
  size: ProfileTileSize;
  data: ProfileTileData;
  /** `grid`: navigates to the profile. Omit for `thumbnail`/`hero`, which are typically embedded in a screen that supplies its own navigation around the tile. */
  onPress?: () => void;
  /**
   * `hero` only — the say-hi/message buttons (and anything else, e.g. inline
   * error text) rendered below the chip row. Fully owned by the caller: the
   * CTA state machine, sheets and navigation stay in `profile/[id].tsx` and
   * `(tabs)/grid.tsx` exactly as before, per the brief's "no behaviour
   * change" (`docs/design/me-redesign/brief.md`, foundation build task 3).
   */
  footer?: ReactNode;
  /** `hero`, Preview mode only (`ProfileEditor`'s Preview tab): renders `footer` at 40% opacity and swallows its touches, since "you can't say hi to yourself." */
  disabledActions?: boolean;
  /**
   * `hero` only — content rendered between the name row and the status line,
   * e.g. the profile screen's pronouns/orientation "more about" row. Not
   * part of the brief's own data-prop list (pronouns/orientation are a
   * separate, `is_public`-gated read `ProfileTile` has no business owning) —
   * documented here as a deliberate, narrow extension so that row can keep
   * living outside this component's data contract.
   */
  identitySlot?: ReactNode;
  /**
   * Overrides the default single `photoUrl`/`tint` background with arbitrary
   * content (typically `src/card/PhotoCarousel.tsx`'s multi-photo swipe).
   * Not part of the brief's data-prop list either — the brief's contract is
   * a single `photoUrl`, but the existing profile screen's multi-photo
   * carousel has to keep working with **no behaviour change**, and that
   * belongs in the caller, not duplicated into this shared component. Grid
   * and thumbnail sizes have never needed more than one photo and don't use
   * this.
   */
  photoSlot?: ReactNode;
  /**
   * `hero` only — content overlaid top-left on the card (the profile
   * screen's own back button). Absent from the brief's data contract for
   * the same reason as `photoSlot`: navigation chrome belongs to the
   * caller, not this shared component.
   */
  topLeft?: ReactNode;
  /**
   * `hero` only — content overlaid top-right on the card (the profile
   * screen's overflow/block-report menu). When `data.hereNow` is true,
   * `ProfileTile` renders its own here-now badge immediately before this
   * content, matching the pre-refactor layout exactly.
   */
  topRight?: ReactNode;
  testIDs?: ProfileTileTestIDs;
  testID?: string;
}

const GRID_VERIFIED_ACCESSIBILITY_LABEL = 'verified student';

/**
 * `photoUrl` + fallback-to-`TintedPlaceholder`-on-load-failure, exactly like
 * the pre-refactor `GridTile.tsx`/`src/card/PhotoCarousel.tsx` each did
 * locally with their own `imageFailed` state. Centralized here so all three
 * `ProfileTile` sizes get the same broken-image behaviour without
 * duplicating the state per call site.
 */
function TilePhoto({
  photoUrl,
  tint,
  photoTestID,
  placeholderTestID,
  style,
}: {
  photoUrl: string | null | undefined;
  tint: string;
  photoTestID?: string;
  placeholderTestID?: string;
  style: StyleProp<ImageStyle>;
}) {
  const [failed, setFailed] = useState(false);
  const showPhoto = !!photoUrl && !failed;

  if (!showPhoto) {
    return <TintedPlaceholder testID={placeholderTestID} tint={tint} />;
  }

  return (
    <Image
      testID={photoTestID}
      source={{ uri: photoUrl as string }}
      style={style}
      onError={() => setFailed(true)}
    />
  );
}

/**
 * `docs/design/me-redesign/brief.md` task 3: the one component the grid,
 * the profile screen, the Me identity row and the editor's Preview tab all
 * render through. `grid` reproduces `GridTile.tsx`'s existing tile exactly;
 * `hero` reproduces `profile/[id].tsx`'s existing full-bleed card (tier
 * pill, name, status, `here for …`/tags chip row, footer slot); `thumbnail`
 * is the new 76x95 tile for the Me row's identity block.
 */
export function ProfileTile({
  size,
  data,
  onPress,
  footer,
  disabledActions = false,
  identitySlot,
  photoSlot,
  topLeft,
  topRight,
  testIDs = {},
  testID,
}: ProfileTileProps) {
  if (size === 'grid') return <GridVariant data={data} onPress={onPress} testIDs={testIDs} testID={testID} />;
  if (size === 'thumbnail') return <ThumbnailVariant data={data} onPress={onPress} testIDs={testIDs} testID={testID} />;
  return (
    <HeroVariant
      data={data}
      footer={footer}
      disabledActions={disabledActions}
      identitySlot={identitySlot}
      photoSlot={photoSlot}
      topLeft={topLeft}
      topRight={topRight}
      testIDs={testIDs}
      testID={testID}
    />
  );
}

// ---------------------------------------------------------------------------
// grid — reproduces src/grid/GridTile.tsx exactly (see that file's own doc
// comment for the design rationale this preserves verbatim).
// ---------------------------------------------------------------------------

function GridVariant({
  data,
  onPress,
  testIDs,
  testID,
}: {
  data: ProfileTileData;
  onPress?: () => void;
  testIDs: ProfileTileTestIDs;
  testID?: string;
}) {
  const tierLabel = tierWord(data.tier);
  const showOnlineDot = !data.hereNow && !!data.isOnline;

  const content = (
    <>
      <TilePhoto
        photoUrl={data.photoUrl}
        tint={data.tint}
        photoTestID={testIDs.photo}
        placeholderTestID={testIDs.placeholder}
        style={styles.gridPhoto}
      />

      {data.hereNow ? <Badge testID={testIDs.hereNow} label="here now" dot style={styles.gridHereNowBadge} /> : null}

      {data.verified ? (
        <View style={styles.gridVerifiedBadge} accessibilityLabel={GRID_VERIFIED_ACCESSIBILITY_LABEL} testID={testIDs.verified}>
          <CheckIcon size={12} color={colors.ink} />
        </View>
      ) : null}

      <View style={styles.gridGradient} pointerEvents="none">
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="tileGradient" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colors.ink} stopOpacity={0} />
              <Stop offset="1" stopColor={colors.ink} stopOpacity={0.55} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#tileGradient)" />
        </Svg>
      </View>

      <View style={styles.gridCaption}>
        <View style={styles.gridNameRow}>
          <View style={styles.gridNameWithDot}>
            <Text variant="title" color={colors.onDark} numberOfLines={1} style={styles.gridName}>
              {data.firstName}
              {data.gradYear ? (
                <Text variant="captionMuted" color={colors.onDark}>{`  '${String(data.gradYear).slice(-2)}`}</Text>
              ) : null}
            </Text>
            {showOnlineDot ? <Dot testID={testIDs.online} color={colors.success} size={7} /> : null}
          </View>
          {tierLabel ? (
            <Text variant="captionMuted" color={colors.onDark} style={styles.gridTier} testID={testIDs.tier}>
              {tierLabel}
            </Text>
          ) : null}
        </View>

        {data.tagLabels?.length ? (
          <View style={styles.gridTags}>
            {data.tagLabels.map((label) => (
              <View key={label} style={styles.gridTag}>
                <Text variant="captionMuted" color={colors.onDark} numberOfLines={1} style={styles.gridTagText}>
                  {label}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </>
  );

  const tileStyle = [styles.gridTile, shadows.md, { backgroundColor: data.tint }];
  const accessibilityLabel = [data.firstName, tierLabel, showOnlineDot ? 'online' : null].filter(Boolean).join(', ');

  if (!onPress) {
    return (
      <View testID={testID ?? testIDs.root} style={tileStyle}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID ?? testIDs.root}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={tileStyle}
    >
      {content}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// thumbnail — the Me row's 76x95 identity tile (`docs/design/me-redesign`,
// task 3: "the 76×95 tile with radius `tile` for the Me row").
// ---------------------------------------------------------------------------

function ThumbnailVariant({
  data,
  onPress,
  testIDs,
  testID,
}: {
  data: ProfileTileData;
  onPress?: () => void;
  testIDs: ProfileTileTestIDs;
  testID?: string;
}) {
  const tileStyle = [styles.thumbnailTile, { backgroundColor: data.tint }];
  const content = (
    <TilePhoto
      photoUrl={data.photoUrl}
      tint={data.tint}
      photoTestID={testIDs.photo}
      placeholderTestID={testIDs.placeholder}
      style={styles.thumbnailPhoto}
    />
  );

  if (!onPress) {
    return (
      <View testID={testID ?? testIDs.root} style={tileStyle}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID ?? testIDs.root}
      accessibilityRole="button"
      accessibilityLabel={data.firstName}
      onPress={onPress}
      style={tileStyle}
    >
      {content}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// hero — reproduces src/app/profile/[id].tsx's existing full-bleed card.
// ---------------------------------------------------------------------------

function HeroVariant({
  data,
  footer,
  disabledActions,
  identitySlot,
  photoSlot,
  topLeft,
  topRight,
  testIDs,
  testID,
}: {
  data: ProfileTileData;
  footer?: ReactNode;
  disabledActions: boolean;
  identitySlot?: ReactNode;
  photoSlot?: ReactNode;
  topLeft?: ReactNode;
  topRight?: ReactNode;
  testIDs: ProfileTileTestIDs;
  testID?: string;
}) {
  const tierLabel = tierWord(data.tier);
  const showOnlineDot = !data.hereNow && !!data.isOnline;
  const hereFor = hereForLabel(data.goals ?? []);

  return (
    <View testID={testID} style={[styles.heroCard, shadows.hero, { backgroundColor: data.tint }]}>
      {photoSlot ?? (
        <View style={styles.heroPhotoFrame}>
          <TilePhoto
            photoUrl={data.photoUrl}
            tint={data.tint}
            photoTestID={testIDs.photo}
            placeholderTestID={testIDs.placeholder}
            style={styles.heroPhoto}
          />
        </View>
      )}

      <View style={styles.heroGradient} pointerEvents="none" />

      {topLeft || topRight ? (
        <View style={styles.heroTopRow}>
          {topLeft ?? <View />}
          <View style={styles.heroTopRowRight}>
            {data.hereNow ? <Badge testID={testIDs.hereNow} label="here now" dot tone="neutral" /> : null}
            {topRight}
          </View>
        </View>
      ) : null}

      <View style={styles.heroBottom}>
        {tierLabel ? (
          <View style={styles.heroTierPill} testID={testIDs.tier}>
            <PinIcon size={12} color={colors.onDark} />
            <Text variant="caption" color={colors.onDark}>
              {tierLabel}
              {data.tier === 'on_campus' && data.campusShort ? ` · ${data.campusShort}` : ''}
            </Text>
          </View>
        ) : null}

        <View style={styles.heroNameRow}>
          <Text variant="hero" color={colors.onDark} testID={testIDs.name}>
            {data.firstName}
            {data.gradYear ? (
              <Text variant="hero" color={colors.onDark} style={styles.heroGradYear}>
                {`  '${String(data.gradYear).slice(-2)}`}
              </Text>
            ) : null}
          </Text>
          {data.verified ? (
            <View style={styles.heroVerifiedBadge} accessibilityLabel={GRID_VERIFIED_ACCESSIBILITY_LABEL} testID={testIDs.verified}>
              <CheckIcon size={12} color={colors.ink} />
            </View>
          ) : null}
          {showOnlineDot ? <Dot testID={testIDs.online} color={colors.success} size={8} /> : null}
        </View>

        {identitySlot}

        {data.statusLine ? (
          <Text variant="body" color={colors.onDark} testID={testIDs.statusLine} style={styles.heroStatusLine}>
            {data.statusLine}
          </Text>
        ) : null}

        <View style={styles.heroChipsRow}>
          {hereFor ? (
            <View style={styles.heroGoalPill} testID={testIDs.goals}>
              <Text variant="captionMuted" color={colors.ink} numberOfLines={1}>
                {hereFor}
              </Text>
            </View>
          ) : null}
          {data.tagLabels?.length ? (
            <View style={styles.heroTagsRow} testID={testIDs.tags}>
              {data.tagLabels.map((label) => (
                <View key={label} style={styles.heroTagChip}>
                  <Text variant="captionMuted" color={colors.onDark} numberOfLines={1}>
                    {label}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        {footer ? (
          <View
            style={disabledActions ? styles.heroFooterDisabled : undefined}
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

// ---------------------------------------------------------------------------

/**
 * The location word for a tile/hero. Duplicated in spirit from
 * `src/grid/tierLabel.ts#tierWord` (kept as the single source of truth for
 * the grid's own row shape — this takes `ProfileTileData['tier']` instead of
 * `PresenceTier` so `ProfileTile` doesn't have to import the presence/geo
 * module tree for one string).
 */
function tierWord(tier: ProfileTileData['tier']): string {
  switch (tier) {
    case 'on_campus':
      return 'on campus';
    case 'nearby':
      return 'nearby';
    case 'county':
    case 'away':
    default:
      return '';
  }
}

const styles = StyleSheet.create({
  // -- grid --
  gridTile: {
    flex: 1,
    aspectRatio: 4 / 5,
    margin: spacing.sm,
    maxWidth: '50%',
    borderRadius: radii.card,
    overflow: 'hidden',
    position: 'relative',
  },
  gridPhoto: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  gridHereNowBadge: { position: 'absolute', top: 10, left: 10 },
  gridVerifiedBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 24,
    height: 24,
    borderRadius: radii.circle,
    backgroundColor: colors.sage,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridGradient: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  gridCaption: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.mdLg, gap: spacing.xs },
  gridNameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.xs },
  gridNameWithDot: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  gridName: { flexShrink: 1 },
  gridTier: { opacity: 0.85 },
  gridTags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  gridTag: {
    paddingHorizontal: spacing.smMd,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(247,243,236,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(247,243,236,0.5)',
  },
  gridTagText: { lineHeight: 13 },

  // -- thumbnail --
  thumbnailTile: {
    width: 76,
    height: 95,
    borderRadius: radii.tile,
    overflow: 'hidden',
    position: 'relative',
  },
  thumbnailPhoto: { width: '100%', height: '100%' },

  // -- hero --
  heroCard: { flex: 1, borderRadius: radii.hero, overflow: 'hidden', position: 'relative' },
  heroPhotoFrame: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  heroPhoto: { width: '100%', height: '100%' },
  heroGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '58%',
    backgroundColor: colors.ink,
    opacity: 0.5,
  },
  heroTopRow: {
    position: 'absolute',
    top: 48,
    left: 14,
    right: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heroTopRowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.smMd },
  heroBottom: { position: 'absolute', left: 20, right: 20, bottom: 24, gap: spacing.mdLg },
  heroTierPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(247,243,236,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(247,243,236,0.45)',
    paddingHorizontal: spacing.mdLg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
  },
  heroNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  heroGradYear: { fontSize: 22 },
  heroVerifiedBadge: {
    width: 24,
    height: 24,
    borderRadius: radii.circle,
    backgroundColor: colors.sage,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroStatusLine: { opacity: 0.92 },
  heroChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' },
  heroGoalPill: {
    paddingHorizontal: spacing.smMd,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.paperRaised,
  },
  heroTagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  heroTagChip: {
    paddingHorizontal: spacing.smMd,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(247,243,236,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(247,243,236,0.5)',
  },
  heroFooterDisabled: { opacity: 0.4 },
});
