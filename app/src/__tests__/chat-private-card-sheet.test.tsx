import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../api/client', () => ({
  SUPABASE_URL: 'https://example.supabase.co',
  supabase: {
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'jwt' } }, error: null }) },
  },
}));

import { getCard, revealCardSection } from '../api/identity';
import { PrivateCardSheet } from '../chat/PrivateCardSheet';
import { ShareBubble } from '../chat/ShareBubble';
import type { ShareFeedItem } from '../chat/shareFeed';

const OWNER = 'aaaaaaaa-1111-4111-8111-111111111111';
const BASE = 'https://example.supabase.co/functions/v1/identity';

/** A share recipient's `GET /identity/card/:owner` (README "Route contracts"). */
const RECIPIENT_BODY = {
  user_id: OWNER,
  shows_interest: ['food'],
  pace: 'slow',
  living_situation: null,
  hosting: "i can't host",
  hard_nos: ['no calls'],
  privacy: ['keep this between us'],
  gated: ['safer_sex', 'dynamics'],
};

type Route = { status: number; body?: unknown };

/** Answers by URL: the card read, and each reveal. Unlisted URLs 404. */
function mockRoutes(routes: Record<string, Route | Route[]>) {
  const counts: Record<string, number> = {};
  const fetchMock = jest.fn((url: string) => {
    const entry = routes[url];
    const n = (counts[url] = (counts[url] ?? 0) + 1);
    const route = Array.isArray(entry) ? entry[Math.min(n, entry.length) - 1] : (entry ?? { status: 404 });
    return Promise.resolve({
      status: route.status,
      ok: route.status >= 200 && route.status < 300,
      json: () => Promise.resolve(route.body),
    });
  });
  (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  return fetchMock;
}

function calledUrls(fetchMock: jest.Mock): string[] {
  return fetchMock.mock.calls.map((call) => call[0] as string);
}

function renderSheet(onDismiss = jest.fn(), onGone = jest.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PrivateCardSheet ownerId={OWNER} ownerName="maya" onDismiss={onDismiss} onGone={onGone} />
    </QueryClientProvider>
  );
}

describe('getCard / revealCardSection (the recipient reads)', () => {
  it("reads the owner's card through the identity function with the caller's jwt: sections plus gated names", async () => {
    const fetchMock = mockRoutes({ [`${BASE}/card/${OWNER}`]: { status: 200, body: RECIPIENT_BODY } });
    const card = await getCard(OWNER);
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/card/${OWNER}`, { headers: { Authorization: 'Bearer jwt' } });
    expect(card?.gated).toEqual(['safer_sex', 'dynamics']);
    expect(card?.sections.hard_nos).toEqual(['no calls']);
    expect(card?.sections.safer_sex).toBeUndefined();
  });

  it('turns the 404 (no active share, including one taken back) into null', async () => {
    mockRoutes({});
    await expect(getCard(OWNER)).resolves.toBeNull();
    await expect(revealCardSection(OWNER, 'safer_sex')).resolves.toBeNull();
  });
});

describe('PrivateCardSheet (payload v2)', () => {
  it('renders getting closer and the boundaries, boundaries last, and one cover per ticked intimacy section', async () => {
    const fetchMock = mockRoutes({ [`${BASE}/card/${OWNER}`]: { status: 200, body: RECIPIENT_BODY } });
    const { findByTestId, getAllByTestId, getByText, queryByTestId } = await renderSheet();
    await findByTestId('private-card-sheet-card-title');
    expect(getByText('more about maya')).toBeTruthy();

    const groups = getAllByTestId(/^private-card-sheet-card-group-[a-z_]+$/).map((node) => node.props.testID);
    expect(groups).toEqual([
      'private-card-sheet-card-group-standard',
      'private-card-sheet-card-group-gated',
      'private-card-sheet-card-group-always_attached',
    ]);
    const sections = getAllByTestId(/^private-card-sheet-card-section-[a-z_]+$/).map((node) => node.props.testID);
    expect(sections.slice(-2)).toEqual(['private-card-sheet-card-section-hard_nos', 'private-card-sheet-card-section-privacy']);

    await findByTestId('private-card-sheet-card-cover-safer_sex');
    await findByTestId('private-card-sheet-card-cover-dynamics');
    expect(queryByTestId('private-card-sheet-card-cover-practices')).toBeNull();
    // Content is never fetched before a tap.
    expect(calledUrls(fetchMock).filter((url) => url.includes('/reveal/'))).toEqual([]);
  });

  it('a tap on a cover fetches that one section and swaps in its values', async () => {
    const fetchMock = mockRoutes({
      [`${BASE}/card/${OWNER}`]: { status: 200, body: RECIPIENT_BODY },
      [`${BASE}/card/${OWNER}/reveal/dynamics`]: {
        status: 200,
        body: { user_id: OWNER, section: 'dynamics', values: ['switch', 'gentle'] },
      },
    });
    const { findByTestId, queryByTestId } = await renderSheet();
    await fireEvent.press(await findByTestId('private-card-sheet-card-cover-dynamics'));

    await findByTestId('private-card-sheet-card-section-dynamics-switch');
    await findByTestId('private-card-sheet-card-section-dynamics-gentle');
    expect(queryByTestId('private-card-sheet-card-cover-dynamics')).toBeNull();
    await findByTestId('private-card-sheet-card-cover-safer_sex');
    expect(calledUrls(fetchMock).filter((url) => url.includes('/reveal/'))).toEqual([`${BASE}/card/${OWNER}/reveal/dynamics`]);
  });

  it('a reveal that 404s re-reads the card, and a card that is gone reports gone', async () => {
    const onGone = jest.fn();
    mockRoutes({
      [`${BASE}/card/${OWNER}`]: [{ status: 200, body: RECIPIENT_BODY }, { status: 404 }],
    });
    const { findByTestId } = await renderSheet(jest.fn(), onGone);
    await fireEvent.press(await findByTestId('private-card-sheet-card-cover-safer_sex'));
    await waitFor(() => expect(onGone).toHaveBeenCalledTimes(1));
  });

  it('a re-share without a section drops its cover on the re-read', async () => {
    mockRoutes({
      [`${BASE}/card/${OWNER}`]: [
        { status: 200, body: RECIPIENT_BODY },
        { status: 200, body: { ...RECIPIENT_BODY, gated: ['dynamics'] } },
      ],
    });
    const onGone = jest.fn();
    const { findByTestId, queryByTestId } = await renderSheet(jest.fn(), onGone);
    await fireEvent.press(await findByTestId('private-card-sheet-card-cover-safer_sex'));
    await waitFor(() => expect(queryByTestId('private-card-sheet-card-cover-safer_sex')).toBeNull());
    await findByTestId('private-card-sheet-card-cover-dynamics');
    expect(onGone).not.toHaveBeenCalled();
  });

  it('reports an empty read (taken back, or the owner vanished) through onGone, once, and says nothing about why', async () => {
    mockRoutes({});
    const onGone = jest.fn();
    const { findByTestId, queryByText } = await renderSheet(jest.fn(), onGone);
    await findByTestId('private-card-sheet-gone');
    await waitFor(() => expect(onGone).toHaveBeenCalledTimes(1));
    expect(queryByText(/sharing|available|banned|suspended|deleted|blocked/i)).toBeNull();
  });

  it('does not report gone for a card that loads', async () => {
    mockRoutes({ [`${BASE}/card/${OWNER}`]: { status: 200, body: RECIPIENT_BODY } });
    const onGone = jest.fn();
    const { findByTestId } = await renderSheet(jest.fn(), onGone);
    await findByTestId('private-card-sheet-card-title');
    expect(onGone).not.toHaveBeenCalled();
  });

  it('says "nothing filled in yet." for a shared card with nothing in it', async () => {
    mockRoutes({ [`${BASE}/card/${OWNER}`]: { status: 200, body: { user_id: OWNER, gated: [] } } });
    const { findByTestId } = await renderSheet();
    await findByTestId('private-card-sheet-empty');
  });

  it('closes', async () => {
    mockRoutes({ [`${BASE}/card/${OWNER}`]: { status: 200, body: RECIPIENT_BODY } });
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
