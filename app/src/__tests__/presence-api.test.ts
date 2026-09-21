// getMyPresence() used to read `user_presence` with no owner filter.
// `user_presence` is owner-only to select under RLS, so this wasn't
// independently exploitable, but every "my row" read in src/api/ now
// filters explicitly rather than leaning on RLS alone
// (src/__tests__/api-owner-filter.test.ts).
const mockGetUser = jest.fn();
const mockMaybeSingle = jest.fn();
const mockSelectEq = jest.fn((..._args: unknown[]) => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = jest.fn((..._args: unknown[]) => ({ eq: mockSelectEq }));
const mockFrom = jest.fn((..._args: unknown[]) => ({ select: mockSelect }));
const mockRpc = jest.fn();

jest.mock('../api/client', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import { getMyPresence } from '../api/presence';

const USER_ID = 'e5e5e5e5-5555-4555-8555-555555555555';

describe('getMyPresence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  });

  it("filters user_presence by .eq('user_id', uid)", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { tier: 'on_campus', tier_computed_at: 'now', is_visible: true },
      error: null,
    });

    const presence = await getMyPresence();

    expect(mockFrom).toHaveBeenCalledWith('user_presence');
    expect(mockSelect).toHaveBeenCalledWith('tier, tier_computed_at, is_visible');
    expect(mockSelectEq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(presence).toEqual({ tier: 'on_campus', tier_computed_at: 'now', is_visible: true });
  });

  it('throws instead of reading when there is no signed-in user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(getMyPresence()).rejects.toThrow('Not signed in.');
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
