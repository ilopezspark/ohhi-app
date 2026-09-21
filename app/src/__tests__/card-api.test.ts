const mockRpc = jest.fn();

jest.mock('../api/client', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

import { getProfileCard } from '../api/profileCard';

const TARGET = '22222222-2222-4222-8222-222222222222';

const CARD_ROW = {
  user_id: TARGET,
  first_name: 'Ada',
  grad_year: 2028,
  status_line: 'hi',
  tier: 'on_campus',
  here_now: false,
  photos: [`${TARGET}/0.jpg`],
  tag_labels: ['coffee'],
  goals: ['friends'],
  my_hi_state: null,
  conversation_id: null,
};

describe('getProfileCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls profile_card_for with p_target and returns the single row', async () => {
    mockRpc.mockResolvedValue({ data: [CARD_ROW], error: null });

    const result = await getProfileCard(TARGET);

    expect(mockRpc).toHaveBeenCalledWith('profile_card_for', { p_target: TARGET });
    expect(result).toEqual(CARD_ROW);
  });

  it('returns null on zero rows (not visible — indistinguishable reasons)', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const result = await getProfileCard(TARGET);

    expect(result).toBeNull();
  });

  it('throws the mapped error when the RPC itself fails', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'not allowed' } });

    await expect(getProfileCard(TARGET)).rejects.toThrow("That didn't work.");
  });
});
