import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../api/client', () => ({ supabase: {}, SUPABASE_URL: 'https://example.test' }));
jest.mock('../api/identity', () => ({ getCard: jest.fn() }));
jest.mock('../api/session', () => ({ currentUserId: jest.fn(() => Promise.resolve('me-1')) }));
jest.mock('../api/shares', () => ({
  ...jest.requireActual('../api/shares'),
  listSharesForSubject: jest.fn(),
}));

import { getCard } from '../api/identity';
import { listSharesForSubject } from '../api/shares';
import { ShareSheet, type ShareSheetProps } from '../chat/ShareSheet';
import { CARD_GROUP_LABELS } from '../me/card/fieldLabels';

const THEM = 'them-1';

function mockMyCard(sections: Record<string, unknown>) {
  (getCard as jest.Mock).mockResolvedValue({ user_id: 'me-1', sections, gated: [] });
}

async function renderSheet(overrides: Partial<ShareSheetProps> = {}) {
  const props: ShareSheetProps = {
    visible: true,
    onDismiss: jest.fn(),
    otherName: 'maya',
    canAttachMedia: true,
    canShareBeyondPhoto: true,
    onPickPhoto: jest.fn(),
    albums: [{ id: 'album-1', name: 'summer', photo_count: 3 } as never],
    albumsLoading: false,
    onShareAlbum: jest.fn(),
    sharingAlbumId: null,
    onSharePrivateCard: jest.fn(),
    sharingCard: false,
    error: null,
    ...overrides,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = await render(
    <QueryClientProvider client={client}>
      <ShareSheet {...props} />
    </QueryClientProvider>
  );
  return { ...utils, props };
}

async function openCardStep(utils: Awaited<ReturnType<typeof renderSheet>>) {
  await fireEvent.press(await utils.findByTestId('share-sheet-card'));
  await utils.findByTestId('share-sheet-ticks');
}

beforeEach(() => {
  jest.clearAllMocks();
  (listSharesForSubject as jest.Mock).mockResolvedValue([]);
});

describe('ShareSheet: the private card', () => {
  it('the card row opens a ticking step instead of sharing at once', async () => {
    mockMyCard({ safer_sex: ['condoms'] });
    const utils = await renderSheet();
    await openCardStep(utils);
    expect(utils.props.onSharePrivateCard).not.toHaveBeenCalled();
    expect(getCard).toHaveBeenCalledWith('me-1');
  });

  it('says getting closer and boundaries always go with it', async () => {
    mockMyCard({});
    const utils = await renderSheet();
    await openCardStep(utils);
    const note = (await utils.findByTestId('share-sheet-card-note')).props.children as string;
    expect(note).toContain(`${CARD_GROUP_LABELS.standard} and ${CARD_GROUP_LABELS.always_attached} always go with it`);
    expect(note).toContain(CARD_GROUP_LABELS.gated);
  });

  it('offers the three intimacy sections, and only the ones with something in them can be ticked', async () => {
    mockMyCard({ safer_sex: ['condoms'], dynamics: [], practices: ['rope', 'wax'] });
    const utils = await renderSheet();
    await openCardStep(utils);
    const safer = await utils.findByTestId('share-sheet-tick-safer_sex');
    const dynamics = await utils.findByTestId('share-sheet-tick-dynamics');
    const practices = await utils.findByTestId('share-sheet-tick-practices');
    expect(safer.props.accessibilityState).toEqual(expect.objectContaining({ disabled: false, checked: false }));
    expect(dynamics.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    expect(practices.props.accessibilityState).toEqual(expect.objectContaining({ disabled: false }));
    expect(utils.getByText('nothing filled in yet')).toBeTruthy();
    expect(utils.getByText('2 picked')).toBeTruthy();

    await fireEvent.press(dynamics);
    expect((await utils.findByTestId('share-sheet-tick-dynamics')).props.accessibilityState.checked).toBe(false);
  });

  it('shares with the ticked sections, in group order, whatever order they were ticked in', async () => {
    mockMyCard({ safer_sex: ['condoms'], dynamics: ['switch'], practices: ['rope'] });
    const utils = await renderSheet();
    await openCardStep(utils);
    await fireEvent.press(await utils.findByTestId('share-sheet-tick-practices'));
    await fireEvent.press(await utils.findByTestId('share-sheet-tick-safer_sex'));
    await fireEvent.press(await utils.findByTestId('share-sheet-card-confirm'));
    expect(utils.props.onSharePrivateCard).toHaveBeenCalledWith(['safer_sex', 'practices']);
  });

  it('unticking takes a section back out', async () => {
    mockMyCard({ safer_sex: ['condoms'], dynamics: ['switch'] });
    const utils = await renderSheet();
    await openCardStep(utils);
    await fireEvent.press(await utils.findByTestId('share-sheet-tick-dynamics'));
    await fireEvent.press(await utils.findByTestId('share-sheet-tick-safer_sex'));
    await fireEvent.press(await utils.findByTestId('share-sheet-tick-dynamics'));
    await fireEvent.press(await utils.findByTestId('share-sheet-card-confirm'));
    expect(utils.props.onSharePrivateCard).toHaveBeenCalledWith(['safer_sex']);
  });

  it('nothing ticked shares getting closer and the boundaries only (an empty list)', async () => {
    mockMyCard({ safer_sex: ['condoms'] });
    const utils = await renderSheet();
    await openCardStep(utils);
    await fireEvent.press(await utils.findByTestId('share-sheet-card-confirm'));
    expect(utils.props.onSharePrivateCard).toHaveBeenCalledWith([]);
  });

  it('with the other person known, starts from the ticks of the share they already have and says it replaces it', async () => {
    mockMyCard({ safer_sex: ['condoms'], dynamics: ['switch'], practices: ['rope'] });
    (listSharesForSubject as jest.Mock).mockResolvedValue([
      { id: 's-old', viewer_id: THEM, revoked_at: '2026-09-01T00:00:00Z', card_sections: ['practices'] },
      { id: 's-live', viewer_id: THEM, revoked_at: null, card_sections: ['dynamics'] },
      { id: 's-other', viewer_id: 'someone-else', revoked_at: null, card_sections: ['safer_sex'] },
    ]);
    const utils = await renderSheet({ otherId: THEM });
    await openCardStep(utils);
    await waitFor(async () =>
      expect((await utils.findByTestId('share-sheet-tick-dynamics')).props.accessibilityState.checked).toBe(true)
    );
    expect((await utils.findByTestId('share-sheet-tick-safer_sex')).props.accessibilityState.checked).toBe(false);
    await utils.findByTestId('share-sheet-card-replaces');
    expect(listSharesForSubject).toHaveBeenCalledWith('private_card', 'me-1');

    // Re-sharing with different ticks goes through the same call.
    await fireEvent.press(await utils.findByTestId('share-sheet-tick-dynamics'));
    await fireEvent.press(await utils.findByTestId('share-sheet-tick-practices'));
    await fireEvent.press(await utils.findByTestId('share-sheet-card-confirm'));
    expect(utils.props.onSharePrivateCard).toHaveBeenCalledWith(['practices']);
  });

  it('never pre-ticks a section that has since been emptied', async () => {
    mockMyCard({ safer_sex: ['condoms'] });
    (listSharesForSubject as jest.Mock).mockResolvedValue([
      { id: 's-live', viewer_id: THEM, revoked_at: null, card_sections: ['dynamics', 'safer_sex'] },
    ]);
    const utils = await renderSheet({ otherId: THEM });
    await openCardStep(utils);
    await utils.findByTestId('share-sheet-card-replaces');
    await fireEvent.press(await utils.findByTestId('share-sheet-card-confirm'));
    expect(utils.props.onSharePrivateCard).toHaveBeenCalledWith(['safer_sex']);
  });

  it('back returns to the menu', async () => {
    mockMyCard({});
    const utils = await renderSheet();
    await openCardStep(utils);
    await fireEvent.press(await utils.findByTestId('share-sheet-card-back'));
    await utils.findByTestId('share-sheet-album');
  });

  it('the card row is disabled, with neutral copy, before both have said something', async () => {
    const utils = await renderSheet({ canShareBeyondPhoto: false });
    const row = await utils.findByTestId('share-sheet-card');
    expect(row.props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(row);
    expect(utils.queryByTestId('share-sheet-ticks')).toBeNull();
    expect(getCard).not.toHaveBeenCalled();
  });

  it('shows the error line on the card step', async () => {
    mockMyCard({});
    const utils = await renderSheet({ error: "That didn't work." });
    await openCardStep(utils);
    await utils.findByTestId('share-sheet-error');
  });
});

describe('ShareSheet: albums (unchanged)', () => {
  it('picks an album and shares it', async () => {
    const utils = await renderSheet();
    await fireEvent.press(await utils.findByTestId('share-sheet-album'));
    await fireEvent.press(await utils.findByTestId('share-sheet-album-album-1'));
    expect(utils.props.onShareAlbum).toHaveBeenCalledWith('album-1');
    expect(getCard).not.toHaveBeenCalled();
  });

  it('back from the album picker returns to the menu', async () => {
    const utils = await renderSheet();
    await fireEvent.press(await utils.findByTestId('share-sheet-album'));
    await fireEvent.press(await utils.findByTestId('share-sheet-albums-back'));
    await utils.findByTestId('share-sheet-card');
  });
});
