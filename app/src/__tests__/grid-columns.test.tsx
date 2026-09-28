import { Dimensions, StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { gridTileWidthFor } from '../layout';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}));
jest.mock('../api/client', () => ({ supabase: {}, SUPABASE_URL: 'https://example.test' }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));

jest.mock('../api/grid', () => ({ gridForMe: jest.fn() }));
jest.mock('../api/me', () => ({ me: jest.fn() }));
jest.mock('../api/presence', () => ({
  getMyPresence: jest.fn(),
  touchActivity: jest.fn(),
  setMyTier: jest.fn(),
  setHereNow: jest.fn(),
  pauseGrid: jest.fn(),
}));
jest.mock('../api/photos', () => ({ listMyPhotos: jest.fn(), signedPhotoUrls: jest.fn() }));
jest.mock('../api/verification', () => ({ startAndOpenVerification: jest.fn() }));

const mockPresenceValue = {
  tier: 'on_campus' as string | null,
  permission: 'granted' as string,
  hereNow: false,
  paused: false,
  countyLabel: 'lake co.',
  ready: true,
  requestPermission: jest.fn(),
  setHereNow: jest.fn().mockResolvedValue(undefined),
  setPaused: jest.fn().mockResolvedValue(undefined),
  refresh: jest.fn().mockResolvedValue(undefined),
  onTierChange: jest.fn(() => () => {}),
};
const mockStoreState = { setHereNow: jest.fn(), setPaused: jest.fn() };
jest.mock('../presence', () => ({
  usePresence: () => mockPresenceValue,
  usePresenceStore: { getState: () => mockStoreState },
  LOCATION_PERMISSION_EXPLAINER: 'location explainer copy',
}));

jest.mock('../realtime', () => ({
  getRealtimeManager: () => ({
    subscribeCampusPresence: jest.fn(() => () => {}),
    reconnect: jest.fn(),
  }),
}));

import { gridForMe } from '../api/grid';
import { me } from '../api/me';
import { getMyPresence } from '../api/presence';
import { listMyPhotos, signedPhotoUrls } from '../api/photos';
import GridScreen from '../app/(tabs)/grid';

/**
 * `docs/app-responsive-plan.md`'s grid column count per window class,
 * verified end to end through the real screen rather than just the
 * `useGridColumns` hook (`layout.test.tsx`), so a regression in how the
 * screen wires the hook into `FlatList` is caught too.
 */
const CAMPUS = '11111111-2222-3333-4444-555555555555';

function setDimensions(width: number, height: number) {
  const dims = { width, height, scale: 1, fontScale: 1 };
  Dimensions.set({ window: dims, screen: dims });
}

// `useSafeAreaInsets()` (now used by `grid.tsx` — `docs/app-responsive-plan.md`)
// needs a `<SafeAreaProvider>` in the tree; `initialMetrics` supplies a value
// synchronously so the hook doesn't throw waiting on a native measurement
// callback that jest's test renderer never fires.
const ZERO_METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <SafeAreaProvider initialMetrics={ZERO_METRICS}>
      <QueryClientProvider client={client}>
        <GridScreen />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockPresenceValue, {
    tier: 'on_campus',
    permission: 'granted',
    hereNow: false,
    paused: false,
    countyLabel: 'lake co.',
  });
  mockPresenceValue.onTierChange.mockReturnValue(() => {});
  (me as jest.Mock).mockResolvedValue({
    id: 'self',
    status: 'active',
    verification_status: 'verified',
    campus_id: CAMPUS,
    campus_slug: 'clc',
    campus_label: 'College of Lake County',
    here_now: false,
  });
  (gridForMe as jest.Mock).mockResolvedValue([
    { user_id: 'u1', first_name: 'Ada', grad_year: 2028, tier: 'on_campus', here_now: false, photo_path: null, tag_labels: [], goals: [], visible_count: 1, here_now_count: 0 },
  ]);
  (getMyPresence as jest.Mock).mockResolvedValue({
    tier: 'on_campus',
    tier_computed_at: new Date().toISOString(),
    is_visible: true,
  });
  (listMyPhotos as jest.Mock).mockResolvedValue([]);
  (signedPhotoUrls as jest.Mock).mockResolvedValue({});
});

describe.each([
  [360, 2],
  [412, 2],
  [600, 3],
  [840, 4],
  [880, 4],
])('grid at %ipx wide', (width, expectedColumns) => {
  it(`sizes tiles for ${expectedColumns} columns`, async () => {
    setDimensions(width, 844);
    const rendered = await renderScreen();
    const tile = await rendered.findByTestId('grid-tile-u1');
    // The test renderer's host tree doesn't expose `FlatList`'s own props
    // (like `numColumns`) — the tile's own rendered `width`, which
    // `GridTile` only ever receives from `useGridTileWidth()`, is the
    // observable stand-in: it's only correct if `grid.tsx` computed the
    // same column count `gridColumnsForWidth`/`layout.test.tsx` expect.
    const style = StyleSheet.flatten(tile.props.style);
    expect(style.width).toBeCloseTo(gridTileWidthFor(width, expectedColumns));
  });
});
