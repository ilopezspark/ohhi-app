// getUserTags() used to read `user_tags` with no owner filter, and
// setUserTags()'s delete had no owner filter either (`.not('tag_id', 'is',
// null)` alone, which — absent the owner-scoped delete RLS policy — would
// have deleted every user's tags, not just the caller's). `user_tags` is
// readable by owner OR same-campus-and-not-blocked (so profile cards can
// show tag chips), so the unfiltered read really could return someone
// else's tags.
const mockGetUser = jest.fn();
const mockOrder = jest.fn();
const mockSelectEq = jest.fn((..._args: unknown[]) => ({ order: mockOrder }));
const mockSelect = jest.fn((..._args: unknown[]) => ({ eq: mockSelectEq }));
const mockDeleteNot = jest.fn();
const mockDeleteEq = jest.fn((..._args: unknown[]) => ({ not: mockDeleteNot }));
const mockDelete = jest.fn((..._args: unknown[]) => ({ eq: mockDeleteEq }));
const mockInsert = jest.fn();
const mockFrom = jest.fn((..._args: unknown[]) => ({ select: mockSelect, delete: mockDelete, insert: mockInsert }));

jest.mock('../api/client', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import { getUserTags, setUserTags } from '../api/tags';

const USER_ID = 'd4d4d4d4-4444-4444-8444-444444444444';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  mockDeleteNot.mockResolvedValue({ error: null });
  mockInsert.mockResolvedValue({ error: null });
});

describe('getUserTags', () => {
  it("filters user_tags by .eq('user_id', uid) before ordering", async () => {
    mockOrder.mockResolvedValue({ data: [{ tag_id: 't1', position: 0 }], error: null });

    const tags = await getUserTags();

    expect(mockFrom).toHaveBeenCalledWith('user_tags');
    expect(mockSelectEq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(tags).toEqual([{ tag_id: 't1', position: 0 }]);
  });
});

describe('setUserTags', () => {
  it("deletes only the caller's own rows before inserting the new set", async () => {
    await setUserTags(['t1', 't2']);

    expect(mockDeleteEq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(mockInsert).toHaveBeenCalledWith([
      { user_id: USER_ID, tag_id: 't1', position: 0 },
      { user_id: USER_ID, tag_id: 't2', position: 1 },
    ]);
  });

  it('rejects more than 3 tags before touching the network', async () => {
    await expect(setUserTags(['t1', 't2', 't3', 't4'])).rejects.toThrow('At most 3 tags are allowed.');
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
