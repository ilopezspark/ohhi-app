// Regression test for the goals bug: `getUserGoals()` used to read
// `user_goals` with no `.eq('user_id', uid)` filter. Under the real RLS
// policy ("user_goals readable by owner or grid rules"), that silently
// returned another readable user's goals instead of throwing — which made
// `setUserGoals()`'s add/remove diff wrong (it diffed against someone
// else's set) and `complete_onboarding()` refuse with "at least one goal is
// required" even though the caller had picked goals.
const mockGetUser = jest.fn();
const mockIn = jest.fn();
const mockDeleteEq = jest.fn((..._args: unknown[]) => ({ in: mockIn }));
const mockDelete = jest.fn((..._args: unknown[]) => ({ eq: mockDeleteEq }));
const mockSelectEq = jest.fn();
const mockSelect = jest.fn((..._args: unknown[]) => ({ eq: mockSelectEq }));
const mockInsert = jest.fn();
const mockFrom = jest.fn((..._args: unknown[]) => ({ select: mockSelect, delete: mockDelete, insert: mockInsert }));

jest.mock('../api/client', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import { getUserGoals, setUserGoals } from '../api/goals';

const USER_ID = 'a1a1a1a1-1111-4111-8111-111111111111';

describe('getUserGoals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  });

  it("reads user_goals filtered to the caller's own user_id", async () => {
    mockSelectEq.mockResolvedValue({ data: [{ goal: 'friends' }, { goal: 'study' }], error: null });

    const goals = await getUserGoals();

    expect(mockFrom).toHaveBeenCalledWith('user_goals');
    expect(mockSelect).toHaveBeenCalledWith('goal');
    expect(mockSelectEq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(goals).toEqual(['friends', 'study']);
  });

  it('throws instead of reading when there is no signed-in user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(getUserGoals()).rejects.toThrow('Not signed in.');
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('setUserGoals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    mockInsert.mockResolvedValue({ error: null });
    mockIn.mockResolvedValue({ error: null });
  });

  it("diffs against only the caller's own current goals (read via getUserGoals) and inserts exactly the newly-picked ones", async () => {
    // The caller's own row set, as `getUserGoals()` (now correctly filtered)
    // would return it — not some other user's rows.
    mockSelectEq.mockResolvedValue({ data: [{ goal: 'friends' }], error: null });

    await setUserGoals(['friends', 'study', 'dates']);

    expect(mockSelectEq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(mockInsert).toHaveBeenCalledWith([
      { user_id: USER_ID, goal: 'study' },
      { user_id: USER_ID, goal: 'dates' },
    ]);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('deletes exactly the removed goals, scoped to the user_id', async () => {
    mockSelectEq.mockResolvedValue({ data: [{ goal: 'friends' }, { goal: 'study' }], error: null });

    await setUserGoals(['friends']);

    expect(mockDeleteEq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(mockIn).toHaveBeenCalledWith('goal', ['study']);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('does nothing when the picked set already matches the current set', async () => {
    mockSelectEq.mockResolvedValue({ data: [{ goal: 'friends' }], error: null });

    await setUserGoals(['friends']);

    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
