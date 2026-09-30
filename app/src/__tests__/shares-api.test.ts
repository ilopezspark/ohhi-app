const mockGetUser = jest.fn();
const mockRpc = jest.fn();
const mockSingle = jest.fn();
const mockInsertSelect = jest.fn((..._args: unknown[]) => ({ single: mockSingle }));
const mockInsert = jest.fn((..._args: unknown[]) => ({ select: mockInsertSelect }));
const mockIsUpdate = jest.fn();
const mockEqUpdate = jest.fn((..._args: unknown[]) => ({ is: mockIsUpdate }));
const mockUpdate = jest.fn((..._args: unknown[]) => ({ eq: mockEqUpdate }));
const mockOr = jest.fn();
const mockEqConv = jest.fn((..._args: unknown[]) => ({ or: mockOr }));
const mockInSelect = jest.fn();
/** Every filter the shares select chain received, in order, and what it finally resolves to. */
const mockSharesSelectCalls: Array<[string, unknown[]]> = [];
const mockSharesSelectResult = jest.fn();
function mockSharesSelectChain(): unknown {
  const chain: Record<string, unknown> = {};
  for (const op of ['eq', 'is', 'in']) {
    chain[op] = (...args: unknown[]) => {
      mockSharesSelectCalls.push([op, args]);
      return chain;
    };
  }
  chain.order = (...args: unknown[]) => {
    mockSharesSelectCalls.push(['order', args]);
    return mockSharesSelectResult();
  };
  return chain;
}
const mockFrom = jest.fn((table: string) => {
  if (table === 'conversations') return { select: jest.fn(() => ({ eq: mockEqConv })) };
  if (table === 'profiles') return { select: jest.fn(() => ({ in: mockInSelect })) };
  return { insert: mockInsert, update: mockUpdate, select: jest.fn(() => mockSharesSelectChain()) };
});

jest.mock('../api/client', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: (table: string) => mockFrom(table),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import {
  listSharesForSubject,
  revokeShare,
  shareAlbum,
  shareCard,
  shareCardSections,
  sharePrivateCard,
  listShareCandidates,
} from '../api/shares';

const ME = '11111111-1111-4111-8111-111111111111';
const VIEWER = '22222222-2222-4222-8222-222222222222';
const ALBUM_ID = 'a6a6a6a6-2222-4a22-8a22-222222222222';
const SHARE_ID = 'share-1';

beforeEach(() => {
  jest.clearAllMocks();
  mockSharesSelectCalls.length = 0;
  mockGetUser.mockResolvedValue({ data: { user: { id: ME } } });
});

describe('shareAlbum', () => {
  it('inserts { owner_id, viewer_id, subject_type: "album", subject_id: albumId }', async () => {
    mockSingle.mockResolvedValue({ data: { id: SHARE_ID }, error: null });

    await shareAlbum(ALBUM_ID, VIEWER);

    expect(mockInsert).toHaveBeenCalledWith({
      owner_id: ME,
      viewer_id: VIEWER,
      subject_type: 'album',
      subject_id: ALBUM_ID,
    });
  });
});

describe('sharePrivateCard', () => {
  it('inserts subject_id = owner_id (the caller), subject_type: "private_card"', async () => {
    mockSingle.mockResolvedValue({ data: { id: SHARE_ID }, error: null });

    await sharePrivateCard(VIEWER);

    expect(mockInsert).toHaveBeenCalledWith({
      owner_id: ME,
      viewer_id: VIEWER,
      subject_type: 'private_card',
      subject_id: ME,
    });
  });

  it('maps a 42501 (blocked/not-mutual refusal) to the generic error', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { code: '42501', message: 'not allowed' } });
    await expect(sharePrivateCard(VIEWER)).rejects.toThrow("That didn't work.");
  });
});

describe('shareCard (reshare_private_card, migration 0023)', () => {
  it('calls the RPC with the viewer and the ticked gated sections, in group order', async () => {
    const row = { id: SHARE_ID, card_sections: ['safer_sex', 'practices'] };
    mockRpc.mockResolvedValue({ data: row, error: null });

    const share = await shareCard(VIEWER, ['practices', 'safer_sex']);

    expect(mockRpc).toHaveBeenCalledWith('reshare_private_card', { p_viewer: VIEWER, p_sections: ['safer_sex', 'practices'] });
    expect(share).toEqual(row);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('sends an empty list when nothing gated is ticked (standard + boundaries only)', async () => {
    mockRpc.mockResolvedValue({ data: { id: SHARE_ID, card_sections: [] }, error: null });
    await shareCard(VIEWER, []);
    expect(mockRpc).toHaveBeenCalledWith('reshare_private_card', { p_viewer: VIEWER, p_sections: [] });
  });

  it('maps a 42501 refusal to the generic error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'not allowed' } });
    await expect(shareCard(VIEWER, ['dynamics'])).rejects.toThrow("That didn't work.");
  });

  it('shareCardSections narrows a row to known gated names in group order', () => {
    expect(shareCardSections({ card_sections: ['practices', 'hosting', 'safer_sex'] })).toEqual(['safer_sex', 'practices']);
    expect(shareCardSections({ card_sections: [] })).toEqual([]);
  });
});

describe('revokeShare', () => {
  it('updates only revoked_at, scoped to a not-yet-revoked row', async () => {
    mockIsUpdate.mockResolvedValue({ error: null });

    await revokeShare(SHARE_ID);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const payload = mockUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['revoked_at']);
    expect(mockEqUpdate).toHaveBeenCalledWith('id', SHARE_ID);
    expect(mockIsUpdate).toHaveBeenCalledWith('revoked_at', null);
  });

  it('is a no-op success (no throw) when it matches zero rows (already revoked)', async () => {
    mockIsUpdate.mockResolvedValue({ error: null });
    await expect(revokeShare(SHARE_ID)).resolves.toBeUndefined();
  });
});

describe('listShareCandidates', () => {
  it('scopes to the caller’s own open conversations, mapped to the other participant', async () => {
    mockOr.mockResolvedValue({
      data: [
        { user_a_id: ME, user_b_id: VIEWER },
        { user_a_id: 'other-user', user_b_id: ME },
      ],
      error: null,
    });
    mockInSelect.mockResolvedValue({
      data: [
        { id: VIEWER, first_name: 'Sam' },
        { id: 'other-user', first_name: 'Robin' },
      ],
      error: null,
    });

    const candidates = await listShareCandidates();

    expect(mockEqConv).toHaveBeenCalledWith('state', 'open');
    expect(candidates).toEqual(
      expect.arrayContaining([
        { userId: VIEWER, firstName: 'Sam' },
        { userId: 'other-user', firstName: 'Robin' },
      ])
    );
    expect(candidates).toHaveLength(2);
  });
});

describe('listSharesForSubject', () => {
  it('filters on owner_id = the signed-in user: the shares select policy also admits rows where I am the viewer', async () => {
    mockSharesSelectResult.mockResolvedValue({ data: [{ id: SHARE_ID }], error: null });

    const rows = await listSharesForSubject('album', ALBUM_ID);

    expect(rows).toEqual([{ id: SHARE_ID }]);
    expect(mockFrom).toHaveBeenCalledWith('shares');
    expect(mockSharesSelectCalls).toEqual(
      expect.arrayContaining([
        ['eq', ['owner_id', ME]],
        ['eq', ['subject_type', 'album']],
        ['eq', ['subject_id', ALBUM_ID]],
      ])
    );
  });
});
