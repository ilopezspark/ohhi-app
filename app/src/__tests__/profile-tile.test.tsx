import { Text as RNText } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { ProfileTile, type ProfileTileData } from '../profile/ProfileTile';

const baseData: ProfileTileData = {
  firstName: 'Ada',
  gradYear: 2028,
  statusLine: 'hello',
  tier: 'on_campus',
  hereNow: false,
  isOnline: false,
  verified: true,
  photoUrl: null,
  tint: '#E8C9B4',
  tagLabels: ['coffee', 'hiking'],
  goals: ['friends', 'study buddies'],
};

describe('ProfileTile — grid size', () => {
  it('renders the placeholder when there is no photoUrl, and the photo when there is', async () => {
    const { getByTestId, queryByTestId } = await render(
      <ProfileTile size="grid" data={baseData} testIDs={{ placeholder: 'ph', photo: 'ph-img' }} />
    );
    expect(getByTestId('ph')).toBeTruthy();
    expect(queryByTestId('ph-img')).toBeNull();

    const { getByTestId: getByTestId2 } = await render(
      <ProfileTile
        size="grid"
        data={{ ...baseData, photoUrl: 'https://example.test/a.jpg' }}
        testIDs={{ placeholder: 'ph2', photo: 'ph2-img' }}
      />
    );
    const img = getByTestId2('ph2-img');
    expect(img.props.source).toEqual({ uri: 'https://example.test/a.jpg' });
  });

  it('shows the here-now badge only when hereNow is true', async () => {
    const { getByTestId } = await render(
      <ProfileTile size="grid" data={{ ...baseData, hereNow: true }} testIDs={{ hereNow: 'hn' }} />
    );
    expect(getByTestId('hn')).toBeTruthy();

    const { queryByTestId } = await render(
      <ProfileTile size="grid" data={{ ...baseData, hereNow: false }} testIDs={{ hereNow: 'hn2' }} />
    );
    expect(queryByTestId('hn2')).toBeNull();
  });

  it('shows the online dot only when hereNow is false and isOnline is true', async () => {
    const { getByTestId } = await render(
      <ProfileTile size="grid" data={{ ...baseData, hereNow: false, isOnline: true }} testIDs={{ online: 'od' }} />
    );
    expect(getByTestId('od')).toBeTruthy();

    const { queryByTestId } = await render(
      <ProfileTile size="grid" data={{ ...baseData, hereNow: true, isOnline: true }} testIDs={{ online: 'od2' }} />
    );
    expect(queryByTestId('od2')).toBeNull();
  });

  it('leaves the tier slot empty for "away" — no word to show', async () => {
    const { queryByTestId } = await render(
      <ProfileTile size="grid" data={{ ...baseData, tier: 'away' }} testIDs={{ tier: 't' }} />
    );
    expect(queryByTestId('t')).toBeNull();
  });

  it('shows "on campus" / "nearby" tier words', async () => {
    const { getByTestId } = await render(
      <ProfileTile size="grid" data={{ ...baseData, tier: 'on_campus' }} testIDs={{ tier: 't' }} />
    );
    expect(getByTestId('t').props.children).toBe('on campus');

    const { getByTestId: getByTestId2 } = await render(
      <ProfileTile size="grid" data={{ ...baseData, tier: 'nearby' }} testIDs={{ tier: 't2' }} />
    );
    expect(getByTestId2('t2').props.children).toBe('nearby');
  });

  it('renders tag labels as given, up to whatever the caller passed', async () => {
    const { getByText } = await render(<ProfileTile size="grid" data={baseData} />);
    expect(getByText('coffee')).toBeTruthy();
    expect(getByText('hiking')).toBeTruthy();
  });

  it('does not render a "here for" goal pill on grid size (goals is a hero-only field)', async () => {
    const { queryByText } = await render(<ProfileTile size="grid" data={baseData} />);
    expect(queryByText(/here for/)).toBeNull();
  });

  it('is pressable and fires onPress with a root testID when given', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(<ProfileTile size="grid" data={baseData} onPress={onPress} testID="tile-1" />);
    await fireEvent.press(getByTestId('tile-1'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders as a non-interactive View (no button role) when onPress is omitted', async () => {
    const { queryByRole } = await render(<ProfileTile size="grid" data={baseData} testID="tile-2" />);
    expect(queryByRole('button')).toBeNull();
  });
});

describe('ProfileTile — thumbnail size', () => {
  it('renders at 76x95 with the tile radius', async () => {
    const { getByTestId } = await render(<ProfileTile size="thumbnail" data={baseData} testID="thumb" />);
    const flat = [getByTestId('thumb').props.style].flat().filter(Boolean);
    expect(flat).toEqual(expect.arrayContaining([expect.objectContaining({ width: 76, height: 95 })]));
  });

  it('shows the placeholder with no photoUrl', async () => {
    const { getByTestId } = await render(<ProfileTile size="thumbnail" data={baseData} testIDs={{ placeholder: 'p' }} />);
    expect(getByTestId('p')).toBeTruthy();
  });
});

describe('ProfileTile — hero size', () => {
  it('renders the name, status line, and tier pill', async () => {
    const { getByText, getByTestId } = await render(
      <ProfileTile size="hero" data={baseData} testIDs={{ tier: 'tier-pill', statusLine: 'status' }} />
    );
    expect(getByText(/Ada/)).toBeTruthy();
    expect(getByTestId('status').props.children).toBe('hello');
    expect(getByTestId('tier-pill')).toBeTruthy();
  });

  it('omits the tier pill for "away"', async () => {
    const { queryByTestId } = await render(
      <ProfileTile size="hero" data={{ ...baseData, tier: 'away' }} testIDs={{ tier: 'tier-pill' }} />
    );
    expect(queryByTestId('tier-pill')).toBeNull();
  });

  it('appends campusShort to the on_campus tier pill', async () => {
    const { getByText } = await render(
      <ProfileTile size="hero" data={{ ...baseData, tier: 'on_campus', campusShort: 'CLC' }} testIDs={{ tier: 'tier-pill' }} />
    );
    expect(getByText(/on campus.*CLC/)).toBeTruthy();
  });

  it('renders a single "here for a · b" pill from goals, using hereForLabel', async () => {
    const { getByTestId, getByText } = await render(
      <ProfileTile size="hero" data={baseData} testIDs={{ goals: 'goals-pill' }} />
    );
    expect(getByTestId('goals-pill')).toBeTruthy();
    expect(getByText('here for friends · study buddies')).toBeTruthy();
  });

  it('omits the goals pill entirely when goals is empty', async () => {
    const { queryByTestId } = await render(
      <ProfileTile size="hero" data={{ ...baseData, goals: [] }} testIDs={{ goals: 'goals-pill' }} />
    );
    expect(queryByTestId('goals-pill')).toBeNull();
  });

  it('shows the online dot only when hereNow is false and isOnline is true (mirrors the tile)', async () => {
    const { getByTestId } = await render(
      <ProfileTile size="hero" data={{ ...baseData, hereNow: false, isOnline: true }} testIDs={{ online: 'od' }} />
    );
    expect(getByTestId('od')).toBeTruthy();

    const { queryByTestId } = await render(
      <ProfileTile size="hero" data={{ ...baseData, hereNow: true, isOnline: true }} testIDs={{ online: 'od2' }} />
    );
    expect(queryByTestId('od2')).toBeNull();
  });

  it('renders identitySlot content between the name row and the status line', async () => {
    const { getByText } = await render(<ProfileTile size="hero" data={baseData} identitySlot={<RNText>she/her</RNText>} />);
    expect(getByText('she/her')).toBeTruthy();
  });

  it('renders photoSlot content instead of the built-in single-photo frame when given', async () => {
    const { getByTestId, queryByTestId } = await render(
      <ProfileTile
        size="hero"
        data={baseData}
        photoSlot={<RNText testID="carousel">carousel</RNText>}
        testIDs={{ placeholder: 'built-in-placeholder' }}
      />
    );
    expect(getByTestId('carousel')).toBeTruthy();
    expect(queryByTestId('built-in-placeholder')).toBeNull();
  });

  it('renders footer content, interactive by default', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(
      <ProfileTile
        size="hero"
        data={baseData}
        footer={
          <RNText testID="cta" onPress={onPress}>
            say hi
          </RNText>
        }
      />
    );
    await fireEvent.press(getByTestId('cta'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('disabledActions renders the footer non-interactively (Preview mode)', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(
      <ProfileTile
        size="hero"
        data={baseData}
        disabledActions
        footer={
          <RNText testID="cta" onPress={onPress}>
            say hi
          </RNText>
        }
      />
    );
    // The footer's own content is deliberately hidden from accessibility
    // (importantForAccessibility="no-hide-descendants") when disabled, so it
    // has to be queried with includeHiddenElements — that hiding is exactly
    // what this test is asserting.
    const cta = getByTestId('cta', { includeHiddenElements: true });
    const wrapper = cta.parent;
    expect(wrapper?.props.pointerEvents).toBe('none');
    expect(wrapper?.props.accessibilityElementsHidden).toBe(true);

    // pointerEvents="none" on the wrapper means a press never reaches it in
    // a real app; RNTL's fireEvent bypasses that, so this only re-confirms
    // the flags above are the mechanism — not a substitute for them.
  });
});
