const mockGetUser = jest.fn();
const mockInsert = jest.fn();
const mockEqDelete2 = jest.fn();
const mockEqDelete1 = jest.fn((..._args: unknown[]) => ({ eq: mockEqDelete2 }));
const mockDelete = jest.fn((..._args: unknown[]) => ({ eq: mockEqDelete1 }));
const mockOrder = jest.fn();
const mockSelect = jest.fn((..._args: unknown[]) => ({ order: mockOrder }));
const mockFrom = jest.fn((..._args: unknown[]) => ({ insert: mockInsert, delete: mockDelete, select: mockSelect }));

jest.mock('../api/client', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import { blockUser, listBlockedUsers, unblockUser } from '../api/blocks';

const ME = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: ME } } });
});

describe('blockUser', () => {
  it('inserts exactly { blocker_id, blocked_id }', async () => {
    mockInsert.mockResolvedValue({ error: null });

    await blockUser(TARGET);

    expect(mockFrom).toHaveBeenCalledWith('blocks');
    expect(mockInsert).toHaveBeenCalledWith({ blocker_id: ME, blocked_id: TARGET });
    const payload = mockInsert.mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual(['blocked_id', 'blocker_id']);
  });

  it('maps a 42501 refusal to the generic error', async () => {
    mockInsert.mockResolvedValue({ error: { code: '42501', message: 'not allowed' } });
    await expect(blockUser(TARGET)).rejects.toThrow("That didn't work.");
  });
});

describe('unblockUser', () => {
  it('deletes by blocker_id and blocked_id, never anyone else’s row', async () => {
    mockEqDelete2.mockResolvedValue({ error: null });

    await unblockUser(TARGET);

    expect(mockFrom).toHaveBeenCalledWith('blocks');
    expect(mockEqDelete1).toHaveBeenCalledWith('blocker_id', ME);
    expect(mockEqDelete2).toHaveBeenCalledWith('blocked_id', TARGET);
  });
});

describe('listBlockedUsers', () => {
  it('selects the embedded profile join and falls back gracefully when it is null', async () => {
    mockOrder.mockResolvedValue({
      data: [{ blocker_id: ME, blocked_id: TARGET, created_at: 'now', blocked: null }],
      error: null,
    });

    const rows = await listBlockedUsers();

    expect(mockSelect).toHaveBeenCalledWith('*, blocked:profiles!blocks_blocked_id_fkey(first_name)');
    expect(rows).toEqual([{ blocker_id: ME, blocked_id: TARGET, created_at: 'now', blocked: null }]);
  });
});
