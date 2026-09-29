import { Text as RNText } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';
import { SafeAreaFrameContext } from 'react-native-safe-area-context';
import { ProfileView, PROFILE_MAX_WIDTH } from '../profile/view/ProfileView';
import { BOTTOM_SCRIM_FADE, BOTTOM_SCRIM_SHARE, heroScrimHeights } from '../profile/view/ProfileHero';
import type { ProfileViewData } from '../profile/view/model';
import { Icon, type IconName } from '../ui/icons';

const MAYA: ProfileViewData = {
  userId: 'u-maya',
  firstName: 'maya',
  gradYear: 2027,
  statusLine: 'at the library till 10 if anyone wants to pretend to study',
  tier: 'on_campus',
  hereNow: true,
  isOnline: true,
  verified: true,
  goals: ['friends', 'study'],
  majorLabel: 'nursing',
  tagLabels: ['gym', 'coffee'],
  sharedLines: ["you're both into gym"],
  pronouns: 'she/her',
  orientation: [],
  campusShort: 'CLC',
  photoPaths: ['p0', 'p1', 'p2'],
  photoUrls: { p0: 'https://example.test/0.jpg', p1: 'https://example.test/1.jpg' },
  placeLine: null,
  prompts: [],
  usualPlaces: null,
  gateOpen: false,
  joinedMonth: null,
  joinedRecency: null,
};

const LUIS: ProfileViewData = {
  ...MAYA,
  userId: 'u-luis',
  firstName: 'luis',
  gradYear: 2029,
  statusLine: null,
  tier: 'nearby',
  hereNow: false,
  isOnline: false,
  goals: [],
  majorLabel: 'business',
  tagLabels: [],
  sharedLines: [],
  pronouns: null,
  photoPaths: ['p0'],
  photoUrls: {},
};

function renderView(data: ProfileViewData, props: Partial<Parameters<typeof ProfileView>[0]> = {}) {
  return render(
    <ProfileView
      data={data}
      onBack={jest.fn()}
      onOverflow={jest.fn()}
      renderActions={({ onPaper }) => <RNText testID="actions">{onPaper ? 'on paper' : 'on photo'}</RNText>}
      {...props}
    />
  );
}

async function scrollTo(screen: Awaited<ReturnType<typeof renderView>>, y: number) {
  await fireEvent.scroll(screen.getByTestId('profile-scroll'), {
    nativeEvent: { contentOffset: { x: 0, y }, contentSize: { height: 4000, width: 390 }, layoutMeasurement: { height: 844, width: 390 } },
  });
}

describe('ProfileView — hero (01, 02, 05)', () => {
  it('renders here now, name, verified check, the pin line, status and the chip row', async () => {
    const screen = await renderView(MAYA);
    expect(screen.getByTestId('profile-here-now-badge')).toHaveTextContent('here now');
    expect(screen.getByTestId('profile-name')).toHaveTextContent('maya');
    expect(screen.getByTestId('profile-verified')).toBeTruthy();
    expect(screen.getByTestId('profile-tier-pill')).toHaveTextContent('on campus');
    expect(screen.getByTestId('profile-meta')).toHaveTextContent("on campus · nursing '27");
    expect(screen.getByTestId('profile-status-line')).toHaveTextContent(/pretend to study/);
    // the chip's short labels (01-profile-top.png), not the picker's "study buddies"
    expect(screen.getByTestId('profile-goals')).toHaveTextContent('here for friends · study');
    expect(screen.getByTestId('profile-goals')).not.toHaveTextContent(/buddies/);
    const tags = screen.getByTestId('profile-tags');
    expect(within(tags).getByText('gym')).toBeTruthy();
    expect(within(tags).getByText('coffee')).toBeTruthy();
    // the major is in the pin line, never a chip
    expect(within(tags).queryByText('nursing')).toBeNull();
  });

  it('hides the here-now pill and shows the online dot when not here now but online', async () => {
    const screen = await renderView({ ...MAYA, hereNow: false, isOnline: true });
    expect(screen.queryByTestId('profile-here-now-badge')).toBeNull();
    expect(screen.getByTestId('profile-online-dot')).toBeTruthy();
  });

  it('has no tier word (and no pin) for away, but keeps major and year', async () => {
    const screen = await renderView({ ...MAYA, tier: 'away' });
    expect(screen.queryByTestId('profile-tier-pill')).toBeNull();
    expect(screen.getByTestId('profile-meta')).toHaveTextContent("nursing '27");
    expect(screen.queryByTestId('icon-pin')).toBeNull();
  });

  it('omits the status line when there is none (02-profile-no-status.png)', async () => {
    const screen = await renderView({ ...MAYA, statusLine: null });
    expect(screen.queryByTestId('profile-status-line')).toBeNull();
    expect(screen.queryByTestId('profile-sparse-notice')).toBeNull();
  });

  it('shows the sparse notice and the goals fallback for a nearly empty profile (05)', async () => {
    const screen = await renderView(LUIS);
    expect(screen.getByTestId('profile-sparse-notice')).toHaveTextContent("luis hasn't filled much in yet. not a red flag.");
    expect(screen.getByTestId('profile-goals')).toHaveTextContent('here for — still figuring it out');
    expect(screen.getByTestId('profile-meta')).toHaveTextContent("nearby · business '29");
    expect(screen.queryByTestId('profile-tags')).toBeNull();
  });

  it('labels the back, overflow and expand buttons', async () => {
    const onBack = jest.fn();
    const onOverflow = jest.fn();
    const screen = await renderView(MAYA, { onBack, onOverflow });
    await fireEvent.press(screen.getByLabelText('back'));
    await fireEvent.press(screen.getByTestId('profile-overflow-trigger'));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onOverflow).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('more about maya')).toBeTruthy();
  });
});

describe('ProfileView — photo pager', () => {
  function activeBar(screen: Awaited<ReturnType<typeof renderView>>, count: number): number {
    for (let i = 0; i < count; i++) {
      const style = [screen.getByTestId(`profile-photo-progress-${i}`, { includeHiddenElements: true }).props.style].flat();
      if (style.some((s: { backgroundColor?: string } | undefined) => s?.backgroundColor === '#F7F3EC')) return i;
    }
    return -1;
  }

  it('draws one progress bar per photo and pages with the chevrons, dimming them at the ends', async () => {
    const screen = await renderView(MAYA);
    expect(activeBar(screen, 3)).toBe(0);
    expect(screen.getByTestId('profile-photo-prev').props.accessibilityState).toEqual({ disabled: true });
    expect(screen.getByTestId('profile-photo-next').props.accessibilityState).toEqual({ disabled: false });

    await fireEvent.press(screen.getByTestId('profile-photo-next'));
    expect(activeBar(screen, 3)).toBe(1);
    await fireEvent.press(screen.getByTestId('profile-photo-next-zone'));
    expect(activeBar(screen, 3)).toBe(2);
    expect(screen.getByTestId('profile-photo-next').props.accessibilityState).toEqual({ disabled: true });

    await fireEvent.press(screen.getByTestId('profile-photo-prev-zone'));
    expect(activeBar(screen, 3)).toBe(1);
  });

  it('falls back to the tint for an unsigned photo', async () => {
    const screen = await renderView(MAYA);
    await fireEvent.press(screen.getByTestId('profile-photo-next'));
    await fireEvent.press(screen.getByTestId('profile-photo-next'));
    expect(screen.getByTestId('profile-photo-placeholder-2')).toBeTruthy();
  });

  it('is one adjustable element for screen readers, and the progress bars are hidden from them', async () => {
    const screen = await renderView(MAYA);
    const area = screen.getByTestId('profile-photo-area');
    expect(area.props.accessibilityRole).toBe('adjustable');
    expect(area.props.accessibilityValue).toEqual({ text: 'photo 1 of 3' });

    await fireEvent(area, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(screen.getByTestId('profile-photo-area').props.accessibilityValue).toEqual({ text: 'photo 2 of 3' });
    await fireEvent(area, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(screen.getByTestId('profile-photo-area').props.accessibilityValue).toEqual({ text: 'photo 1 of 3' });

    expect(screen.queryByTestId('profile-photo-progress')).toBeNull();
    const bars = screen.getByTestId('profile-photo-progress', { includeHiddenElements: true });
    expect(bars.props.accessibilityElementsHidden).toBe(true);
    expect(bars.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('with one photo: a single bar and no chevrons (05)', async () => {
    const screen = await renderView(LUIS);
    expect(screen.getByTestId('profile-photo-progress-0', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('profile-photo-progress-1', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByTestId('profile-photo-prev')).toBeNull();
    expect(screen.queryByTestId('profile-photo-next')).toBeNull();
  });
});

describe('ProfileView — detail list (03, 04)', () => {
  it('renders shared, basics, photo 2, into, photo 3 and the footer, in that order', async () => {
    const screen = await renderView(MAYA);
    const details = screen.getByTestId('profile-details');
    const order = ['profile-shared', 'profile-basics', 'profile-photo-card-1', 'profile-into', 'profile-photo-card-2', 'profile-footer'];
    const ids = details.children.map((child) => {
      const node = typeof child === 'string' ? null : child.children[0];
      return node && typeof node !== 'string' ? node.props.testID : null;
    });
    expect(ids).toEqual(order);
  });

  it('what you two share lists the shared tags, and is hidden when nothing is shared', async () => {
    const screen = await renderView(MAYA);
    expect(screen.getByTestId('profile-shared')).toHaveTextContent(/you're both into gym/);

    const none = await renderView({ ...MAYA, sharedLines: [] });
    expect(none.queryByTestId('profile-shared')).toBeNull();
  });

  it('the basics shows major + year and pronouns only when public', async () => {
    const screen = await renderView(MAYA);
    expect(screen.getByTestId('profile-basics-major')).toHaveTextContent(/nursing/);
    expect(screen.getByTestId('profile-basics-major')).toHaveTextContent(/class of '27/);
    expect(screen.getByTestId('profile-identity')).toHaveTextContent('she/her');

    const privateIdentity = await renderView({ ...MAYA, pronouns: null });
    expect(privateIdentity.queryByTestId('profile-identity')).toBeNull();
  });

  it('into lists the tags and is hidden without any', async () => {
    const screen = await renderView(MAYA);
    expect(within(screen.getByTestId('profile-into')).getByText('coffee')).toBeTruthy();
    const none = await renderView(LUIS);
    expect(none.queryByTestId('profile-into')).toBeNull();
    expect(none.queryByTestId('profile-photo-card-1')).toBeNull();
  });

  it('footer: verified student at the campus, and report or block opens the overflow', async () => {
    const onOverflow = jest.fn();
    const screen = await renderView(MAYA, { onOverflow });
    expect(screen.getByTestId('profile-footer-verified')).toHaveTextContent('verified student at CLC');
    // no joined_month: no "since" claim at all
    expect(screen.getByTestId('profile-footer')).not.toHaveTextContent(/since/);
    await fireEvent.press(screen.getByTestId('profile-report-block'));
    expect(onOverflow).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('report or block maya')).toBeTruthy();
  });

  it('preview hides report/block and overflow, and makes the action bar untouchable', async () => {
    const screen = await renderView(MAYA, { preview: true });
    expect(screen.queryByTestId('profile-report-block')).toBeNull();
    expect(screen.queryByTestId('profile-overflow-trigger')).toBeNull();
    const bar = screen.getByTestId('profile-action-bar', { includeHiddenElements: true });
    expect(bar.props.pointerEvents).toBe('none');
    expect(bar.props.accessibilityElementsHidden).toBe(true);
  });
});

describe('ProfileView — scrolling (03)', () => {
  it('shows the collapsed header once the photo scrolls away, and hides it again at the top', async () => {
    const screen = await renderView(MAYA);
    expect(screen.queryByTestId('profile-header')).toBeNull();
    expect(screen.getByTestId('actions')).toHaveTextContent('on photo');

    await scrollTo(screen, 3000);
    const header = screen.getByTestId('profile-header');
    expect(header).toHaveTextContent(/maya/);
    expect(screen.getByTestId('profile-header-here-now')).toHaveTextContent('here now');
    expect(screen.getByLabelText('back to the photos')).toBeTruthy();
    expect(screen.getByTestId('actions')).toHaveTextContent('on paper');

    await scrollTo(screen, 0);
    expect(screen.queryByTestId('profile-header')).toBeNull();
    expect(screen.getByTestId('actions')).toHaveTextContent('on photo');
  });

  it("the collapsed header's overflow opens the same sheet", async () => {
    const onOverflow = jest.fn();
    const screen = await renderView(MAYA, { onOverflow });
    await scrollTo(screen, 3000);
    await fireEvent.press(screen.getByTestId('profile-header-overflow'));
    expect(onOverflow).toHaveBeenCalledTimes(1);
  });

  it('on a wide screen the photo, header and bar run edge to edge; only the content is capped and centred', async () => {
    const flat = (node: { props: { style?: unknown } }) => Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));
    const screen = await renderView(MAYA);
    await fireEvent(screen.getByTestId('profile-view'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 900, height: 800 } } });
    const side = (900 - PROFILE_MAX_WIDTH) / 2;

    // The scroll view (and so the hero inside it) is not capped: nothing
    // leaves a bare strip beside the photo and its scrims.
    expect(flat(screen.getByTestId('profile-scroll')).width).toBeUndefined();
    expect(flat(screen.getByTestId('profile-hero')).width).toBe('100%');
    expect(flat(screen.getByTestId('profile-hero')).height).toBe(800);
    // The hero's bars sit in the centred column.
    expect(flat(screen.getByTestId('profile-photo-progress', { includeHiddenElements: true }))).toMatchObject({
      left: 16 + side,
      right: 16 + side,
    });
    // The details are capped and centred.
    expect(flat(screen.getByTestId('profile-details'))).toMatchObject({ width: PROFILE_MAX_WIDTH, alignSelf: 'center' });

    // The action bar spans the window; its content is capped.
    const bar = flat(screen.getByTestId('profile-action-bar'));
    expect(bar).toMatchObject({ position: 'absolute', left: 0, right: 0, bottom: 0 });
    expect(flat(screen.getByTestId('profile-action-bar-content'))).toMatchObject({ width: PROFILE_MAX_WIDTH, alignSelf: 'center' });

    // So does the collapsed header, from the very top.
    await scrollTo(screen, 3000);
    expect(flat(screen.getByTestId('profile-header'))).toMatchObject({ position: 'absolute', top: 0, left: 0, right: 0 });
    expect(flat(screen.getByTestId('profile-header-row'))).toMatchObject({ width: PROFILE_MAX_WIDTH, alignSelf: 'center' });
  });

  it('on a phone the content column is the full width', async () => {
    const screen = await renderView(MAYA);
    await fireEvent(screen.getByTestId('profile-view'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } } });
    const details = Object.assign({}, ...[screen.getByTestId('profile-details').props.style].flat(Infinity).filter(Boolean));
    expect(details.width).toBe(390);
  });
});

describe('ProfileView — hero layout (the phone report: scrim stopped short)', () => {
  const flat = (node: { props: { style?: unknown } }) => Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));

  async function laidOut(width: number, height: number, contentHeight = 300, data: ProfileViewData = MAYA) {
    const screen = await renderView(data);
    await fireEvent(screen.getByTestId('profile-view'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width, height } } });
    await fireEvent(screen.getByTestId('profile-hero'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width, height } } });
    // The hero's bottom block: here now … chips, plus the space kept for the bar.
    const block = screen.getByTestId('profile-name').parent;
    let node = block;
    while (node && flat(node).position !== 'absolute') node = node.parent;
    await fireEvent(node!, 'layout', { nativeEvent: { layout: { x: 0, y: height - contentHeight, width, height: contentHeight } } });
    return screen;
  }

  it.each([
    [390, 844],
    [624, 986],
    [360, 880],
    [900, 800],
  ])('at %ix%i the hero is exactly the view tall and the bottom scrim is anchored to its bottom edge', async (width, height) => {
    const screen = await laidOut(width, height);
    expect(flat(screen.getByTestId('profile-hero')).height).toBe(height);

    const scrim = flat(screen.getByTestId('profile-bottom-scrim'));
    expect(scrim).toMatchObject({ position: 'absolute', left: 0, right: 0, bottom: 0 });
    expect(scrim.top).toBeUndefined();
    expect(scrim.height).toBe(Math.round(height * BOTTOM_SCRIM_SHARE));

    // The gradient is drawn at the box's own size in plain numbers (a
    // percentage-sized SVG kept its first-frame size on Android).
    const svg = screen.getByTestId('profile-bottom-scrim-svg');
    expect(svg.props.bbWidth ?? svg.props.width).toBe(width);
    expect(svg.props.bbHeight ?? svg.props.height).toBe(Math.round(height * BOTTOM_SCRIM_SHARE));
  });

  it('grows the bottom scrim above a tall text block, never past the hero', async () => {
    const tall = await laidOut(390, 844, 600);
    expect(flat(tall.getByTestId('profile-bottom-scrim')).height).toBe(600 + BOTTOM_SCRIM_FADE);
    const huge = await laidOut(390, 844, 800);
    expect(flat(huge.getByTestId('profile-bottom-scrim')).height).toBe(844);
  });

  it('keeps a top scrim under the status bar', async () => {
    const screen = await laidOut(390, 844);
    expect(flat(screen.getByTestId('profile-top-scrim'))).toMatchObject({ position: 'absolute', top: 0, left: 0, right: 0, height: 110 });
  });

  it('follows a resize (rotation, a fold opening): hero and scrim take the new size', async () => {
    const screen = await laidOut(390, 844);
    await fireEvent(screen.getByTestId('profile-view'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 844, height: 390 } } });
    await fireEvent(screen.getByTestId('profile-hero'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 844, height: 390 } } });
    expect(flat(screen.getByTestId('profile-hero')).height).toBe(390);
    // A short landscape hero: the text block (300) plus its fade needs more
    // than the hero has, so the scrim covers all of it.
    expect(flat(screen.getByTestId('profile-bottom-scrim')).height).toBe(390);
    const svg = screen.getByTestId('profile-bottom-scrim-svg');
    expect(svg.props.bbWidth ?? svg.props.width).toBe(844);
  });

  it('before its first layout, sizes the hero from the safe-area frame, not the window', async () => {
    const screen = await render(
      <SafeAreaFrameContext.Provider value={{ x: 0, y: 0, width: 412, height: 915 }}>
        <ProfileView data={MAYA} onBack={jest.fn()} />
      </SafeAreaFrameContext.Provider>
    );
    expect(flat(screen.getByTestId('profile-hero')).height).toBe(915);
  });

  it('heroScrimHeights: at least the share, above the text, capped at the hero', () => {
    expect(heroScrimHeights(1000, 40, 200)).toEqual({ top: 150, bottom: 620 });
    expect(heroScrimHeights(1000, 40, 700)).toEqual({ top: 150, bottom: 820 });
    expect(heroScrimHeights(500, 40, 700)).toEqual({ top: 150, bottom: 500 });
    expect(heroScrimHeights(100, 40, 0)).toEqual({ top: 100, bottom: 100 });
  });

  it('shows the photo covering the hero, never stretched', async () => {
    const screen = await laidOut(360, 880);
    const image = screen.getByTestId('profile-photo-image-0');
    expect(image.props.resizeMode ?? flat(image).resizeMode).toBe('cover');
  });
});

describe('ProfileView — names are lowercase (owner ruling)', () => {
  it('shows a capitalised stored name in lowercase everywhere it is a title or label', async () => {
    const screen = await renderView({ ...LUIS, firstName: 'Tyler', usualPlaces: ['library'] });
    expect(screen.getByTestId('profile-name')).toHaveTextContent('tyler');
    expect(screen.getByTestId('profile-sparse-notice')).toHaveTextContent("tyler hasn't filled much in yet. not a red flag.");
    expect(screen.getByLabelText('more about tyler')).toBeTruthy();
    expect(screen.getByLabelText('photos of tyler')).toBeTruthy();
    expect(screen.getByLabelText('report or block tyler')).toBeTruthy();
    expect(screen.getByTestId('profile-around-campus')).toHaveTextContent(/where tyler usually ends up/);
    expect(screen.queryByText(/Tyler/)).toBeNull();
    await scrollTo(screen, 3000);
    expect(screen.getByTestId('profile-header')).toHaveTextContent(/tyler/);
    expect(screen.queryByText(/Tyler/)).toBeNull();
  });
});

describe('profile redesign icons', () => {
  const NEW_ICONS: IconName[] = ['chevronUp', 'chevronDown', 'cap', 'tag', 'flag', 'shield', 'people'];
  it.each(NEW_ICONS)('renders %s on the 24x24 viewBox', async (name) => {
    const { getByTestId } = await render(<Icon name={name} testID="icon" />);
    const svg = getByTestId('icon').props;
    expect([svg.minX, svg.minY, svg.vbWidth, svg.vbHeight]).toEqual([0, 0, 24, 24]);
  });
});
