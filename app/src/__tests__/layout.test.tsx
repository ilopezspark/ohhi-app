import { useEffect } from 'react';
import { Dimensions } from 'react-native';
import { render, screen, act } from '@testing-library/react-native';
import {
  windowClassForWidth,
  contentWidthForWindow,
  gridColumnsForWidth,
  gridTileWidthFor,
  heroMaxHeightFor,
  useWindowClass,
  useGridColumns,
} from '../layout';
import { Text } from '../ui';

const originalWindow = Dimensions.get('window');

afterEach(() => {
  // `Dimensions.set` (used below to simulate a live width change, e.g. an
  // unfold) is global RN state — restore it so later tests/files aren't
  // affected by whatever the last test in this file left it at.
  Dimensions.set({ window: originalWindow, screen: originalWindow });
});

/** Before an initial mount — no `act` wrapper needed (there's no fiber tree yet to warn about). */
const setInitialDimensions = (width: number, height: number) => {
  const dims = { width, height, scale: 1, fontScale: 1 };
  Dimensions.set({ window: dims, screen: dims });
};

/** After mount — wrapped in `act` so the resulting re-render is flushed before the next assertion. */
const setDimensionsLive = async (width: number, height: number) => {
  const dims = { width, height, scale: 1, fontScale: 1 };
  await act(async () => {
    Dimensions.set({ window: dims, screen: dims });
  });
};

describe('windowClassForWidth', () => {
  // The five widths the responsive plan names explicitly: a phone (360),
  // the 390 design baseline (412 is close enough to a real Android phone),
  // the medium/expanded breakpoints themselves, and the Z Fold's ~880 inner
  // width.
  it.each([
    [360, 'compact'],
    [412, 'compact'],
    [599, 'compact'],
    [600, 'medium'],
    [839, 'medium'],
    [840, 'expanded'],
    [880, 'expanded'],
  ])('classifies %ipx as %s', (width, expected) => {
    expect(windowClassForWidth(width)).toBe(expected);
  });
});

describe('contentWidthForWindow', () => {
  it('is full width under the cap', () => {
    expect(contentWidthForWindow(360)).toBe(360);
    expect(contentWidthForWindow(412)).toBe(412);
  });

  it('caps at 520 on wide windows', () => {
    expect(contentWidthForWindow(600)).toBe(520);
    expect(contentWidthForWindow(880)).toBe(520);
  });
});

describe('gridColumnsForWidth / gridTileWidthFor', () => {
  it.each([
    [360, 2],
    [412, 2],
    [600, 3],
    [840, 4],
    [880, 4],
  ])('%ipx -> %i columns', (width, columns) => {
    expect(gridColumnsForWidth(width)).toBe(columns);
  });

  it('clamps tile width between 150 and 220', () => {
    expect(gridTileWidthFor(360, 2)).toBeGreaterThanOrEqual(150);
    expect(gridTileWidthFor(360, 2)).toBeLessThanOrEqual(220);
    // A narrow 2-column window and a wide 4-column window should land at
    // roughly comparable, both-usable tile sizes — neither tiny nor huge.
    const narrow = gridTileWidthFor(360, 2);
    const wide = gridTileWidthFor(880, 4);
    expect(narrow).toBeGreaterThanOrEqual(150);
    expect(wide).toBeLessThanOrEqual(220);
  });
});

describe('heroMaxHeightFor', () => {
  it('is uncapped (undefined) on compact', () => {
    expect(heroMaxHeightFor('compact', 844)).toBeUndefined();
  });

  it('caps on medium/expanded, never exceeding the ceiling', () => {
    expect(heroMaxHeightFor('medium', 844)).toBeLessThanOrEqual(640);
    // Z Fold inner: near-square, ~880x840 — this is exactly the case the
    // brief calls out ("must not stretch absurdly tall").
    const capped = heroMaxHeightFor('expanded', 840);
    expect(capped).toBeLessThanOrEqual(640);
    expect(capped).toBeLessThan(840);
  });
});

function ClassProbe() {
  const cls = useWindowClass();
  const columns = useGridColumns();
  return <Text testID="probe">{`${cls}:${columns}`}</Text>;
}

describe('useWindowClass / useGridColumns react live to useWindowDimensions', () => {
  it('re-renders with the new class and column count on a width change, without remounting', async () => {
    let mountCount = 0;
    function CountingProbe() {
      // A mount-only effect: if the width change below ever remounted this
      // component instead of just re-rendering it, this would fire again
      // and the assertion below would fail.
      useEffect(() => {
        mountCount += 1;
      }, []);
      return <ClassProbe />;
    }

    setInitialDimensions(390, 844);
    await render(<CountingProbe />);
    expect(screen.getByTestId('probe').props.children).toBe('compact:2');
    expect(mountCount).toBe(1);

    // Simulate an unfold: `Dimensions.set` fires the same 'change' event RN
    // itself fires on a real dimensions change, which is what
    // `useWindowDimensions` (and so `useWindowClass`/`useGridColumns`)
    // subscribes to — no remount, just a re-render of the same tree.
    await setDimensionsLive(880, 840);
    expect(screen.getByTestId('probe').props.children).toBe('expanded:4');
    expect(mountCount).toBe(1);
  });
});
