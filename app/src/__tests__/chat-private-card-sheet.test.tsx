import { fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../api/client', () => ({
  SUPABASE_URL: 'https://example.supabase.co',
  supabase: {
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'jwt' } }, error: null }) },
  },
}));

import { getSharedPrivateCard } from '../api/identity';
import { PrivateCardSheet } from '../chat/PrivateCardSheet';
import { ShareBubble } from '../chat/ShareBubble';
import type { ShareFeedItem } from '../chat/shareFeed';

const OWNER = 'aaaaaaaa-1111-4111-8111-111111111111';

function mockFetch(status: number, body?: unknown) {
  const fetchMock = jest.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
  });
  (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  return fetchMock;
}

function renderSheet(onDismiss = jest.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PrivateCardSheet ownerId={OWNER} ownerName="maya" onDismiss={onDismiss} />
    </QueryClientProvider>
  );
}

describe('getSharedPrivateCard', () => {
  it("reads the owner's card through the identity function with the caller's jwt", async () => {
    const fetchMock = mockFetch(200, { into: ['hiking'], safer_sex: [], kinks: [], hard_nos: ['smoking'] });
    const card = await getSharedPrivateCard(OWNER);
    expect(fetchMock).toHaveBeenCalledWith(`https://example.supabase.co/functions/v1/identity/card/${OWNER}`, {
      headers: { Authorization: 'Bearer jwt' },
    });
    expect(card).toEqual({ into: ['hiking'], safer_sex: [], kinks: [], hard_nos: ['smoking'] });
  });

  it('turns the 404 (no active share, including one taken back) into null', async () => {
    mockFetch(404);
    await expect(getSharedPrivateCard(OWNER)).resolves.toBeNull();
  });
});

describe('PrivateCardSheet', () => {
  it('renders the full card through the shared PrivateCardView, hard nos last', async () => {
    mockFetch(200, { into: ['hiking'], safer_sex: ['always'], kinks: ['x'], hard_nos: ['smoking'] });
    const { findByTestId, getAllByTestId, getByText } = await renderSheet();
    await findByTestId('private-card-sheet-card-title');
    expect(getByText('more about maya')).toBeTruthy();
    const groups = getAllByTestId(/^private-card-sheet-card-group-[a-z_]+$/).map((node) => node.props.testID);
    expect(groups[groups.length - 1]).toBe('private-card-sheet-card-group-hard_nos');
  });

  it('says plainly when the card is no longer shared', async () => {
    mockFetch(404);
    const { findByTestId } = await renderSheet();
    const gone = await findByTestId('private-card-sheet-gone');
    expect(gone.props.children).toBe("maya isn't sharing this with you any more.");
  });

  it('closes', async () => {
    mockFetch(404);
    const onDismiss = jest.fn();
    const { findByTestId } = await renderSheet(onDismiss);
    await fireEvent.press(await findByTestId('private-card-sheet-close'));
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe('ShareBubble (private card)', () => {
  function item(overrides: Partial<ShareFeedItem> = {}): ShareFeedItem {
    return {
      id: 'share-1',
      kind: 'private_card',
      ownerId: OWNER,
      viewerId: 'me',
      subjectId: OWNER,
      createdAt: '2026-09-20T12:00:00.000Z',
      ...overrides,
    };
  }

  it('an incoming card bubble opens the card', async () => {
    const onPress = jest.fn();
    const { findByTestId } = await render(<ShareBubble item={item()} mine={false} otherName="maya" onPress={onPress} />);
    await fireEvent.press(await findByTestId('share-bubble-press-share-1'));
    expect(onPress).toHaveBeenCalled();
  });

  it('my own outgoing card bubble is tappable too (it opens my card screen)', async () => {
    const onPress = jest.fn();
    const { findByTestId } = await render(
      <ShareBubble item={item({ ownerId: 'me', viewerId: OWNER })} mine otherName="maya" onPress={onPress} />
    );
    await fireEvent.press(await findByTestId('share-bubble-press-share-1'));
    expect(onPress).toHaveBeenCalled();
  });
});
