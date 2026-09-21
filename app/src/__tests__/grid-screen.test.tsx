import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

// The presence module owns timers, AppState and expo-location. The grid only
// consumes its four scalars and four callbacks, so stub the hook and drive the
// screen from those values directly.
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

const mockSubscribeCampusPresence = jest.fn(
  (_campusId: string, _handlers: { onHereNow: (e: { user_id: string; here_now: boolean }) => void }) =>
    () => {}
);
jest.mock('../realtime', () => ({
  getRealtimeManager: () => ({
    subscribeCampusPresence: mockSubscribeCampusPresence,
    reconnect: jest.fn(),
  }),
}));

import { gridForMe } from '../api/grid';
import { me } from '../api/me';
import { getMyPresence } from '../api/presence';
import { listMyPhotos, signedPhotoUrls } from '../api/photos';
import GridScreen from '../app/(tabs)/grid';

const CAMPUS = '11111111-2222-3333-4444-555555555555';

const meRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'self',
  status: 'active',
  verification_status: 'verified',
  campus_id: CAMPUS,
  campus_slug: 'clc',
  campus_label: 'College of Lake County',
  here_now: false,
  goals_count: 1,
  tags_count: 2,
  photos_count: 1,
  ...overrides,
});

const gridRow = (overrides: Record<string, unknown> = {}) => ({
  user_id: 'u1',
  first_name: 'Ada',
  grad_year: 2028,
  status_line: 'hello',
  tier: 'on_campus',
  here_now: false,
  last_active_at: '2026-09-21T11:00:00Z',
  photo_path: 'u1/0.jpg',
  tag_labels: ['coffee', 'hiking'],
  goals: ['friends'],
  visible_count: 1,
  here_now_count: 0,
  ...overrides,
});

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <GridScreen />
    </QueryClientProvider>
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
  (me as jest.Mock).mockResolvedValue(meRow());
  (gridForMe as jest.Mock).mockResolvedValue([]);
  (getMyPresence as jest.Mock).mockResolvedValue({
    tier: 'on_campus',
    tier_computed_at: new Date().toISOString(),
    is_visible: true,
  });
  (listMyPhotos as jest.Mock).mockResolvedValue([
    { user_id: 'self', position: 0, moderation_state: 'ok', storage_path: 'self/0.jpg', tint: '#abc' },
  ]);
  (signedPhotoUrls as jest.Mock).mockResolvedValue({ 'u1/0.jpg': 'https://signed.test/u1' });
});

describe('GridScreen — tiles', () => {
  it('renders the RPC rows in the order returned, without re-sorting', async () => {
    (gridForMe as jest.Mock).mockResolvedValue([
      gridRow({ user_id: 'u1', first_name: 'Ada', tier: 'on_campus' }),
      gridRow({ user_id: 'u2', first_name: 'Bea', tier: 'county', photo_path: null }),
      gridRow({ user_id: 'u3', first_name: 'Cyd', tier: 'nearby', here_now: true }),
    ]);

    const { getByTestId, getByText, getAllByText } = await renderScreen();

    await waitFor(() => expect(getByTestId('grid-tile-u1')).toBeTruthy());
    // The name node also carries the grad year as a nested <Text>, so these
    // match "Ada  '28" rather than "Ada" exactly.
    expect(getByText(/Ada/)).toBeTruthy();
    expect(getByText(/Bea/)).toBeTruthy();
    expect(getByText(/Cyd/)).toBeTruthy();
    expect(getAllByText(/'28/)).toHaveLength(3);
  });

  it('shows the tier word, using campuses.county_label for the county tier', async () => {
    (gridForMe as jest.Mock).mockResolvedValue([
      gridRow({ user_id: 'u1', tier: 'on_campus' }),
      gridRow({ user_id: 'u2', tier: 'county' }),
      gridRow({ user_id: 'u3', tier: 'nearby' }),
    ]);

    const { getByTestId } = await renderScreen();

    await waitFor(() => expect(getByTestId('grid-tile-tier-u1')).toBeTruthy());
    expect(getByTestId('grid-tile-tier-u1').props.children).toBe('on campus');
    expect(getByTestId('grid-tile-tier-u2').props.children).toBe('lake co.');
    expect(getByTestId('grid-tile-tier-u3').props.children).toBe('nearby');
  });

  it('shows the here-now indicator only for here_now rows', async () => {
    (gridForMe as jest.Mock).mockResolvedValue([
      gridRow({ user_id: 'u1', here_now: true }),
      gridRow({ user_id: 'u2', here_now: false }),
    ]);

    const { getByTestId, queryByTestId } = await renderScreen();

    await waitFor(() => expect(getByTestId('grid-tile-here-now-u1')).toBeTruthy());
    expect(queryByTestId('grid-tile-here-now-u2')).toBeNull();
  });

  it('renders the two tag labels the RPC returns', async () => {
    (gridForMe as jest.Mock).mockResolvedValue([gridRow({ tag_labels: ['coffee', 'hiking'] })]);
    const { getByText } = await renderScreen();
    await waitFor(() => expect(getByText('coffee')).toBeTruthy());
    expect(getByText('hiking')).toBeTruthy();
  });

  it('uses the signed URL when there is one and the tinted placeholder when there is not', async () => {
    (gridForMe as jest.Mock).mockResolvedValue([
      gridRow({ user_id: 'u1', photo_path: 'u1/0.jpg' }),
      gridRow({ user_id: 'u2', photo_path: null }),
    ]);

    const { getByTestId, queryByTestId } = await renderScreen();

    await waitFor(() => expect(getByTestId('grid-tile-photo-u1')).toBeTruthy());
    expect(getByTestId('grid-tile-photo-u1').props.source).toEqual({
      uri: 'https://signed.test/u1',
    });
    expect(getByTestId('grid-tile-placeholder-u2')).toBeTruthy();
    expect(queryByTestId('grid-tile-placeholder-u1')).toBeNull();
  });

  it('falls back to the placeholder when a path could not be signed', async () => {
    (signedPhotoUrls as jest.Mock).mockResolvedValue({});
    (gridForMe as jest.Mock).mockResolvedValue([gridRow({ user_id: 'u1', photo_path: 'u1/0.jpg' })]);

    const { getByTestId } = await renderScreen();
    await waitFor(() => expect(getByTestId('grid-tile-placeholder-u1')).toBeTruthy());
  });
});

describe('GridScreen — empty and paused states', () => {
  it('shows the empty-state copy when the grid comes back with no rows', async () => {
    (gridForMe as jest.Mock).mockResolvedValue([]);
    const { getByTestId } = await renderScreen();
    await waitFor(() => expect(getByTestId('grid-empty')).toBeTruthy());
  });

  it('keeps browsing working while paused, and shows the paused banner', async () => {
    mockPresenceValue.paused = true;
    (gridForMe as jest.Mock).mockResolvedValue([gridRow()]);

    const { getByTestId } = await renderScreen();

    await waitFor(() => expect(getByTestId('grid-paused-banner')).toBeTruthy());
    // grid_for_me() never checks the caller's own is_visible, so a paused user
    // still sees everyone (onboarding-grid plan §3).
    expect(getByTestId('grid-tile-u1')).toBeTruthy();
    expect(getByTestId('grid-paused-resume')).toBeTruthy();
  });

  it('does not repeat the paused reason in the not-visible banner', async () => {
    mockPresenceValue.paused = true;
    (getMyPresence as jest.Mock).mockResolvedValue({
      tier: 'on_campus',
      tier_computed_at: new Date().toISOString(),
      is_visible: false,
    });

    const { getByTestId, queryByTestId } = await renderScreen();

    await waitFor(() => expect(getByTestId('grid-paused-banner')).toBeTruthy());
    expect(queryByTestId('grid-not-visible-paused')).toBeNull();
  });
});

describe('GridScreen — the "you\'re not visible because…" banner', () => {
  it('shows nothing when the caller is fully visible', async () => {
    const { getByTestId, queryByTestId } = await renderScreen();
    await waitFor(() => expect(getByTestId('grid-list')).toBeTruthy());
    expect(queryByTestId('grid-not-visible-unverified')).toBeNull();
    expect(queryByTestId('grid-paused-banner')).toBeNull();
  });

  it('prompts for verification when the caller is only email_verified', async () => {
    (me as jest.Mock).mockResolvedValue(meRow({ verification_status: 'email_verified' }));
    const { getByTestId } = await renderScreen();
    await waitFor(() => expect(getByTestId('grid-not-visible-unverified')).toBeTruthy());
    expect(getByTestId('grid-not-visible-action')).toBeTruthy();
  });

  it.each([
    ['id_pending', 'grid-not-visible-id_pending'],
    ['manual_review', 'grid-not-visible-manual_review'],
    ['id_failed', 'grid-not-visible-id_failed'],
  ])('shows the %s verification state', async (status, testID) => {
    (me as jest.Mock).mockResolvedValue(meRow({ verification_status: status }));
    const { getByTestId } = await renderScreen();
    await waitFor(() => expect(getByTestId(testID)).toBeTruthy());
  });

  it('offers no retry while an ID check is pending', async () => {
    (me as jest.Mock).mockResolvedValue(meRow({ verification_status: 'id_pending' }));
    const { getByTestId, queryByTestId } = await renderScreen();
    await waitFor(() => expect(getByTestId('grid-not-visible-id_pending')).toBeTruthy());
    expect(queryByTestId('grid-not-visible-action')).toBeNull();
  });

  it('explains a photo still under review', async () => {
    (listMyPhotos as jest.Mock).mockResolvedValue([
      { user_id: 'self', position: 0, moderation_state: 'pending', storage_path: 'self/0.jpg', tint: '#abc' },
    ]);
    const { getByTestId } = await renderScreen();
    await waitFor(() => expect(getByTestId('grid-not-visible-photo_pending')).toBeTruthy());
  });

  it('distinguishes a location denial from being genuinely far away', async () => {
    mockPresenceValue.tier = 'away';
    mockPresenceValue.permission = 'denied';
    const { getByTestId } = await renderScreen();
    await waitFor(() => expect(getByTestId('grid-not-visible-permission_denied')).toBeTruthy());
  });

  it('shows the away copy when location works and the user is far', async () => {
    mockPresenceValue.tier = 'away';
    mockPresenceValue.permission = 'granted';
    const { getByTestId } = await renderScreen();
    await waitFor(() => expect(getByTestId('grid-not-visible-tier_away')).toBeTruthy());
  });

  it('shows the stale-tier fallback', async () => {
    (getMyPresence as jest.Mock).mockResolvedValue({
      tier: 'on_campus',
      tier_computed_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      is_visible: true,
    });
    const { getByTestId } = await renderScreen();
    await waitFor(() => expect(getByTestId('grid-not-visible-tier_stale')).toBeTruthy());
  });

  it('shows the pre-prompt explainer while permission is undetermined', async () => {
    mockPresenceValue.permission = 'undetermined';
    const { getByTestId } = await renderScreen();
    await waitFor(() => expect(getByTestId('grid-location-explainer')).toBeTruthy());
  });
});

describe('GridScreen — presence wiring', () => {
  it('subscribes to this campus presence topic once me() resolves', async () => {
    await renderScreen();
    await waitFor(() => expect(mockSubscribeCampusPresence).toHaveBeenCalled());
    expect(mockSubscribeCampusPresence.mock.calls[0][0]).toBe(CAMPUS);
  });

  it('merges a here-now broadcast into a held row and drops unknown user_ids', async () => {
    (gridForMe as jest.Mock).mockResolvedValue([gridRow({ user_id: 'u1', here_now: false })]);
    const { getByTestId, queryByTestId } = await renderScreen();
    await waitFor(() => expect(getByTestId('grid-tile-u1')).toBeTruthy());

    const handlers = mockSubscribeCampusPresence.mock.calls[0][1] as unknown as {
      onHereNow: (event: { user_id: string; here_now: boolean }) => void;
    };

    // A stranger who isn't in our grid: ignored entirely, no new tile.
    handlers.onHereNow({ user_id: 'blocked-user', here_now: true });
    await waitFor(() => expect(queryByTestId('grid-tile-blocked-user')).toBeNull());

    // Someone we already hold: merged in place.
    handlers.onHereNow({ user_id: 'u1', here_now: true });
    await waitFor(() => expect(getByTestId('grid-tile-here-now-u1')).toBeTruthy());
  });

  it('exposes the here-now and pause controls in the header', async () => {
    const { getByTestId } = await renderScreen();
    await waitFor(() => expect(getByTestId('here-now-toggle')).toBeTruthy());
    expect(getByTestId('pause-toggle')).toBeTruthy();
  });

  it('passes no coordinate-shaped argument to any mocked api function', async () => {
    (gridForMe as jest.Mock).mockResolvedValue([gridRow()]);
    await renderScreen();
    await waitFor(() => expect(signedPhotoUrls).toHaveBeenCalled());

    const serialised = JSON.stringify([
      (gridForMe as jest.Mock).mock.calls,
      (me as jest.Mock).mock.calls,
      (getMyPresence as jest.Mock).mock.calls,
      (listMyPhotos as jest.Mock).mock.calls,
      (signedPhotoUrls as jest.Mock).mock.calls,
    ]);
    expect(serialised).not.toMatch(/latitude|longitude|"lat"|"lng"|coords/i);
  });
});
