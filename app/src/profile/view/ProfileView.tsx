import { useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { BackIcon, CheckIcon, ChevronDownIcon, Dot, MoreIcon, Text } from '../../ui';
import { tintForPhoto } from '../../photos/tint';
import { colors, hairline, radii, spacing } from '../../theme/tokens';
import { isSparse, sparseNotice, type ProfileViewData } from './model';
import { PhotoPager } from './PhotoPager';
import { PhotoIconButton, ProfileHero } from './ProfileHero';
import { detailSections } from './sections';
import { useInsets } from './useInsets';

/** Wider than this (tablets, open foldables) the view stops growing and centres. */
export const PROFILE_MAX_WIDTH = 560;
const HEADER_BAR = 56;
/** First-frame guess for the action bar's height, before `onLayout` measures it. */
const ACTION_BAR_ESTIMATE = 88;
const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

export interface ProfileViewActionState {
  /** True once the view has scrolled off the photo: the bar sits on paper, not on the photo. */
  onPaper: boolean;
}

export interface ProfileViewProps {
  data: ProfileViewData;
  onBack?: () => void;
  /** Opens the report/block sheet — the hero's `…`, the collapsed header's `…` and the footer link. Omit to hide all three. */
  onOverflow?: () => void;
  /** The sticky action bar's content (say hi + message, plus any error line). */
  renderActions?: (state: ProfileViewActionState) => ReactNode;
  /**
   * Preview of your own profile (the editor's Preview tab): the action bar at
   * 40% and untouchable, no report/block, gated content shown with its note,
   * and laid out inside its container (no safe-area insets of its own; the
   * hero is as tall as the container rather than the window).
   */
  preview?: boolean;
  /** testID prefix for every part, default `profile`. */
  testIDPrefix?: string;
}

/**
 * The whole profile screen body (`docs/design/profile-redesign/`): the
 * full-screen hero, the detail list under it, the collapsed header that
 * takes over once the photo scrolls away (`03-profile-scrolled.png`), and
 * the sticky action bar. It owns layout and scroll only; the data, the
 * say-hi/message state machine and the report/block sheet stay with the
 * caller (`app/profile/[id].tsx`). Built so the editor's Preview can render
 * it too (`preview`), keeping preview and reality on one component.
 */
export function ProfileView({ data, onBack, onOverflow, renderActions, preview = false, testIDPrefix = 'profile' }: ProfileViewProps) {
  const p = testIDPrefix;
  const safeInsets = useInsets();
  const insets = preview ? NO_INSETS : safeInsets;
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // The hero fills the view. On the profile screen that is the window; in
  // the editor's Preview it is the tab's own area, measured on layout.
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  const contentWidth = Math.min(measured?.width ?? windowWidth, PROFILE_MAX_WIDTH);
  const heroHeight = measured?.height ?? windowHeight;
  const headerHeight = insets.top + HEADER_BAR;

  const scrollRef = useRef<ScrollView>(null);
  const [scrollY, setScrollY] = useState(0);
  const [barHeight, setBarHeight] = useState(ACTION_BAR_ESTIMATE + insets.bottom);

  function onRootLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0 && (width !== measured?.width || height !== measured?.height)) {
      setMeasured({ width, height });
    }
  }

  const collapsed = scrollY >= heroHeight - headerHeight - 1;
  const onPaper = scrollY > spacing.xxl;

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const y = event.nativeEvent.contentOffset.y;
    // Only re-render when a threshold is crossed, not on every frame.
    const nextCollapsed = y >= heroHeight - headerHeight - 1;
    const nextOnPaper = y > spacing.xxl;
    if (nextCollapsed !== collapsed || nextOnPaper !== onPaper) setScrollY(y);
  }

  function onBarLayout(event: LayoutChangeEvent) {
    const h = Math.round(event.nativeEvent.layout.height);
    if (h > 0 && h !== barHeight) setBarHeight(h);
  }

  function toDetail() {
    scrollRef.current?.scrollTo({ y: heroHeight - headerHeight, animated: true });
  }

  function toTop() {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  const sparse = isSparse(data);
  const sections = detailSections(data, { prefix: p, onReportOrBlock: preview ? undefined : onOverflow, preview });
  const actions = renderActions?.({ onPaper });

  return (
    <View style={styles.root} testID={`${p}-view`} onLayout={onRootLayout}>
      <View style={[styles.column, { width: contentWidth }]}>
        <ScrollView
          ref={scrollRef}
          testID={`${p}-scroll`}
          onScroll={onScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: barHeight + spacing.lgXl }}
        >
          <ProfileHero
            frame="bleed"
            height={heroHeight}
            topInset={insets.top}
            bottomSpace={actions ? barHeight : insets.bottom}
            data={data}
            tint={tintForPhoto(data.userId, 0)}
            photoSlot={
              <PhotoPager
                userId={data.userId}
                firstName={data.firstName}
                paths={data.photoPaths}
                urls={data.photoUrls}
                barsTop={insets.top + spacing.md}
                testIDPrefix={p}
              />
            }
            topLeft={
              onBack ? (
                <PhotoIconButton testID={`${p}-back`} accessibilityLabel="back" onPress={onBack}>
                  <BackIcon size={20} color={colors.onDark} />
                </PhotoIconButton>
              ) : undefined
            }
            topRight={
              onOverflow && !preview ? (
                <PhotoIconButton testID={`${p}-overflow-trigger`} accessibilityLabel="more options" onPress={onOverflow}>
                  <MoreIcon size={20} color={colors.onDark} />
                </PhotoIconButton>
              ) : undefined
            }
            notice={sparse ? sparseNotice(data.firstName, data.joinedRecency) : null}
            onExpand={toDetail}
            testIDs={{
              root: `${p}-hero`,
              hereNow: `${p}-here-now-badge`,
              online: `${p}-online-dot`,
              tier: `${p}-tier-pill`,
              place: `${p}-place-line`,
              meta: `${p}-meta`,
              verified: `${p}-verified`,
              name: `${p}-name`,
              statusLine: `${p}-status-line`,
              goals: `${p}-goals`,
              tags: `${p}-tags`,
              notice: `${p}-sparse-notice`,
              expand: `${p}-expand`,
            }}
          />

          <View style={styles.details} testID={`${p}-details`}>
            {sections.map((section) => (
              <View key={section.key}>{section.render()}</View>
            ))}
          </View>
        </ScrollView>

        {collapsed ? (
          <View style={[styles.header, { paddingTop: insets.top, height: headerHeight }]} testID={`${p}-header`}>
            <Pressable
              testID={`${p}-header-collapse`}
              accessibilityRole="button"
              accessibilityLabel="back to the photos"
              onPress={toTop}
              style={styles.headerButton}
            >
              <ChevronDownIcon size={24} color={colors.ink} />
            </Pressable>
            <View style={styles.headerTitle} accessibilityRole="header">
              <Text variant="title" style={styles.headerName} numberOfLines={1}>
                {data.firstName}
              </Text>
              {data.verified ? (
                <View style={styles.headerVerified} accessibilityLabel="verified student">
                  <CheckIcon size={11} color={colors.ink} />
                </View>
              ) : null}
              {data.hereNow ? (
                <View style={styles.headerHereNow} testID={`${p}-header-here-now`}>
                  <Dot color={colors.signal} size={7} />
                  <Text variant="labelLg" color={colors.muted}>
                    here now
                  </Text>
                </View>
              ) : null}
            </View>
            {onOverflow && !preview ? (
              <Pressable
                testID={`${p}-header-overflow`}
                accessibilityRole="button"
                accessibilityLabel="more options"
                onPress={onOverflow}
                style={styles.headerButton}
              >
                <MoreIcon size={22} color={colors.ink} />
              </Pressable>
            ) : (
              <View style={styles.headerButton} />
            )}
          </View>
        ) : null}

        {actions ? (
          <View
            onLayout={onBarLayout}
            testID={`${p}-action-bar`}
            style={[
              styles.actionBar,
              { paddingBottom: insets.bottom + spacing.mdLg },
              onPaper && styles.actionBarOnPaper,
              preview && styles.actionBarPreview,
            ]}
            pointerEvents={preview ? 'none' : 'box-none'}
            accessibilityElementsHidden={preview}
            importantForAccessibility={preview ? 'no-hide-descendants' : 'auto'}
          >
            {actions}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper, alignItems: 'center' },
  column: { flex: 1, maxWidth: '100%' },
  details: { paddingHorizontal: spacing.lgXl, paddingTop: spacing.xxl, gap: spacing.lgXl },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
    backgroundColor: colors.paper,
    borderBottomWidth: hairline.width,
    borderBottomColor: colors.lineSoft,
  },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.smMd, paddingLeft: spacing.mdLg },
  headerName: { fontSize: 20, lineHeight: 24, flexShrink: 1 },
  headerVerified: {
    width: 22,
    height: 22,
    borderRadius: radii.circle,
    backgroundColor: colors.sage,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerHereNow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  actionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lgXl,
    paddingTop: spacing.mdLg,
  },
  actionBarOnPaper: {
    backgroundColor: colors.paper,
    borderTopWidth: hairline.width,
    borderTopColor: colors.lineSoft,
  },
  actionBarPreview: { opacity: 0.4 },
});
