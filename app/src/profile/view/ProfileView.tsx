import { useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { BackIcon, CheckIcon, ChevronDownIcon, Dot, MoreIcon, Text } from '../../ui';
import { displayName } from '../../ui/displayName';
import { tintForPhoto } from '../../photos/tint';
import { colors, hairline, radii, spacing } from '../../theme/tokens';
import { isSparse, sparseNotice, type ProfileViewData } from './model';
import { PhotoPager } from './PhotoPager';
import { PhotoIconButton, ProfileHero } from './ProfileHero';
import { detailSections } from './sections';
import { BeforeYouMessageSheet, BeforeYouMessageStrip } from './BeforeYouMessage';
import { beforeYouMessageItems } from './identityCards';
import { useInsets, useScreenFrame } from './useInsets';
import { photoReplySubject, type ProfileReplyOptions } from './reply';

/**
 * Wider than this (tablets, open foldables) the view's *content* stops
 * growing and centres. The photo and its scrims, the collapsed header and
 * the action bar's paper still run edge to edge, so no bare strip is left
 * down either side of the window.
 */
export const PROFILE_MAX_WIDTH = 560;
const HEADER_BAR = 56;
/** First-frame guess for the action bar's height, before `onLayout` measures it. */
const ACTION_BAR_ESTIMATE = 88;
/** The hero's top buttons (`ProfileHero`'s bleed `topRow`): this far under the top inset, 44 tall. */
const HERO_BUTTON_OFFSET = 26;
const HERO_BUTTON_SIZE = 44;

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
   * Preview of your own profile (`app/profile-preview.tsx`): the action bar at
   * 40% and untouchable, no report/block, and gated content shown with its
   * note. Everything else, the full-screen hero and the safe-area insets
   * included, is the real profile screen's layout.
   */
  preview?: boolean;
  /** testID prefix for every part, default `profile`. */
  testIDPrefix?: string;
  /**
   * Reply to a prompt answer or photo (migration 0024, decision 100): what
   * `profile_reply_targets` allows, and what a tap does. Only those get a
   * reply action. Ignored in `preview`.
   */
  reply?: ProfileReplyOptions;
}

/**
 * The whole profile screen body (`docs/design/profile-redesign/`): the
 * full-screen hero, the detail list under it, the collapsed header that
 * takes over once the photo scrolls away (`03-profile-scrolled.png`), and
 * the sticky action bar. It owns layout and scroll only; the data, the
 * say-hi/message state machine and the report/block sheet stay with the
 * caller (`app/profile/[id].tsx`). Your own preview (`app/profile-preview.tsx`)
 * renders it too (`preview`), keeping preview and reality on one component.
 *
 * "before you message me" (reconcile C4): when the person set any requests,
 * a one-line strip is docked inside the sticky action bar directly above
 * say-hi, so it is in view at every scroll position; tapping it opens a
 * small sheet with the full list. The bar grows by that one line only when
 * there is something to show. In `preview` it is greyed and untouchable with
 * the rest of the bar.
 */
export function ProfileView({
  data,
  onBack,
  onOverflow,
  renderActions,
  preview = false,
  testIDPrefix = 'profile',
  reply,
}: ProfileViewProps) {
  const p = testIDPrefix;
  const replies = preview ? undefined : reply;
  const insets = useInsets();
  const screen = useScreenFrame();
  // The hero is exactly as tall as this view: on the profile screen that is
  // the whole screen (edge to edge, under both system bars), as it is on
  // the preview. It comes from `onLayout`, so rotation, a fold opening and
  // split screen resize it. Until the first
  // layout, the safe-area frame (the root view's real size) stands in, not
  // the window: on Android the window can leave out the system bars.
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  const viewWidth = measured?.width ?? screen.width;
  const contentWidth = Math.min(viewWidth, PROFILE_MAX_WIDTH);
  /** Space either side of the centred content column (0 on a phone). */
  const sideInset = Math.max(0, (viewWidth - contentWidth) / 2);
  const heroHeight = measured?.height ?? screen.height;
  const name = displayName(data.firstName);
  const headerHeight = insets.top + HEADER_BAR;

  const scrollRef = useRef<ScrollView>(null);
  const [scrollY, setScrollY] = useState(0);
  const [barHeight, setBarHeight] = useState(ACTION_BAR_ESTIMATE + insets.bottom);
  const [requestsOpen, setRequestsOpen] = useState(false);

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
  const sections = detailSections(data, { prefix: p, onReportOrBlock: preview ? undefined : onOverflow, preview, reply: replies });
  // The hero's reply button sits in the top right corner, under the `…`
  // when there is one.
  const heroButtonsTop = insets.top + HERO_BUTTON_OFFSET;
  const hasOverflowButton = !!onOverflow && !preview;
  const heroReply = replies
    ? {
        top: hasOverflowButton ? heroButtonsTop + HERO_BUTTON_SIZE + spacing.smMd : heroButtonsTop,
        canReply: (path: string) => !!replies.index.photos[path],
        onReply: (path: string, position: number) => {
          const subject = photoReplySubject(path, position, replies.index);
          if (subject) replies.onReply(subject);
        },
      }
    : undefined;
  const actions = renderActions?.({ onPaper });
  const requests = beforeYouMessageItems(data.identityCards);
  const strip =
    requests.length > 0 ? (
      <BeforeYouMessageStrip items={requests} onPress={() => setRequestsOpen(true)} testID={`${p}-before-you-message-strip`} />
    ) : null;
  const hasBar = !!actions || !!strip;

  return (
    <View style={styles.root} testID={`${p}-view`} onLayout={onRootLayout}>
      <ScrollView
        ref={scrollRef}
        testID={`${p}-scroll`}
        style={styles.scroll}
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: barHeight + spacing.lgXl }}
      >
        <ProfileHero
          frame="bleed"
          height={heroHeight}
          width={viewWidth}
          topInset={insets.top}
          sideInset={sideInset}
          bottomSpace={hasBar ? barHeight : insets.bottom}
          data={data}
          tint={tintForPhoto(data.userId, 0)}
          photoSlot={
            <PhotoPager
              userId={data.userId}
              firstName={name}
              paths={data.photoPaths}
              urls={data.photoUrls}
              badges={data.photoBadges}
              barsTop={insets.top + spacing.md}
              sideInset={sideInset}
              testIDPrefix={p}
              reply={heroReply}
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
            topScrim: `${p}-top-scrim`,
            bottomScrim: `${p}-bottom-scrim`,
          }}
        />

        <View style={[styles.details, { width: contentWidth }]} testID={`${p}-details`}>
          {sections.map((section) => (
            <View key={section.key}>{section.render()}</View>
          ))}
        </View>
      </ScrollView>

      {collapsed ? (
        // Full width and from the very top (under the status bar); only
        // the row inside is held to the content column.
        <View style={[styles.header, { paddingTop: insets.top, height: headerHeight }]} testID={`${p}-header`}>
          <View style={[styles.headerRow, { width: contentWidth }]} testID={`${p}-header-row`}>
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
                {name}
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
        </View>
      ) : null}

      {hasBar ? (
        // Full width and down to the bottom edge (the home-indicator /
        // gesture inset is inside its padding), so on paper its fill
        // leaves no gap; the buttons are held to the content column.
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
          <View style={[styles.actionBarContent, { width: contentWidth }]} pointerEvents="box-none" testID={`${p}-action-bar-content`}>
            {strip}
            {actions}
          </View>
        </View>
      ) : null}

      {requestsOpen && requests.length > 0 && !preview ? (
        <BeforeYouMessageSheet
          items={requests}
          onDismiss={() => setRequestsOpen(false)}
          testID={`${p}-before-you-message-sheet`}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  scroll: { flex: 1 },
  details: {
    alignSelf: 'center',
    maxWidth: '100%',
    paddingHorizontal: spacing.lgXl,
    paddingTop: spacing.xxl,
    gap: spacing.lgXl,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.paper,
    borderBottomWidth: hairline.width,
    borderBottomColor: colors.lineSoft,
  },
  headerRow: {
    flex: 1,
    alignSelf: 'center',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
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
    paddingTop: spacing.mdLg,
  },
  actionBarContent: { alignSelf: 'center', maxWidth: '100%', paddingHorizontal: spacing.lgXl, gap: spacing.smMd },
  actionBarOnPaper: {
    backgroundColor: colors.paper,
    borderTopWidth: hairline.width,
    borderTopColor: colors.lineSoft,
  },
  actionBarPreview: { opacity: 0.4 },
});
