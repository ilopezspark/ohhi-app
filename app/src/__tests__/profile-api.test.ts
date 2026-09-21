// Regression test for the profile bug: `getFirstName()` used to call
// `supabase.from('profiles').select('first_name').maybeSingle()` with no
// filter at all. `profiles` is readable by owner OR same-campus-and-not-
// blocked (so profile cards work), so as soon as a second readable row
// existed, `.maybeSingle()` threw "multiple (or no) rows returned".
const mockGetUser = jest.fn();
const mockMaybeSingle = jest.fn();
const mockSelectEq = jest.fn((..._args: unknown[]) => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = jest.fn((..._args: unknown[]) => ({ eq: mockSelectEq }));
const mockUpdateEq = jest.fn();
const mockUpdate = jest.fn((..._args: unknown[]) => ({ eq: mockUpdateEq }));
const mockFrom = jest.fn((..._args: unknown[]) => ({ select: mockSelect, update: mockUpdate }));

jest.mock('../api/client', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import { getFirstName, getStatusLine, updateProfile } from '../api/profile';

const USER_ID = 'b2b2b2b2-2222-4222-8222-222222222222';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
});

describe('getFirstName', () => {
  it("filters profiles by .eq('id', uid) before .maybeSingle(), so a second readable row can't throw or leak", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { first_name: 'Ada' }, error: null });

    const name = await getFirstName();

    expect(mockFrom).toHaveBeenCalledWith('profiles');
    expect(mockSelect).toHaveBeenCalledWith('first_name');
    expect(mockSelectEq).toHaveBeenCalledWith('id', USER_ID);
    expect(name).toBe('Ada');
  });

  it('throws instead of reading when there is no signed-in user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(getFirstName()).rejects.toThrow('Not signed in.');
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('getStatusLine', () => {
  it("filters profiles by .eq('id', uid) the same way", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { status_line: 'hi' }, error: null });

    const line = await getStatusLine();

    expect(mockSelectEq).toHaveBeenCalledWith('id', USER_ID);
    expect(line).toBe('hi');
  });
});

describe('updateProfile', () => {
  it("updates only the caller's own row via .eq('id', uid)", async () => {
    mockUpdateEq.mockResolvedValue({ error: null });

    await updateProfile({ first_name: 'Sam' });

    expect(mockUpdate).toHaveBeenCalledWith({ first_name: 'Sam' });
    expect(mockUpdateEq).toHaveBeenCalledWith('id', USER_ID);
  });
});
