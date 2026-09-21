// getDateOfBirth() used to read `users_private` with no owner filter. That
// table is owner-only to select under RLS, so this wasn't independently
// exploitable, but every "my row" read in src/api/ now filters explicitly
// rather than leaning on RLS alone (src/__tests__/api-owner-filter.test.ts).
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

import { getDateOfBirth, setDateOfBirth } from '../api/onboarding';

const USER_ID = 'c3c3c3c3-3333-4333-8333-333333333333';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
});

describe('getDateOfBirth', () => {
  it("filters users_private by .eq('user_id', uid)", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { date_of_birth: '2000-01-01' }, error: null });

    const dob = await getDateOfBirth();

    expect(mockFrom).toHaveBeenCalledWith('users_private');
    expect(mockSelectEq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(dob).toBe('2000-01-01');
  });
});

describe('setDateOfBirth', () => {
  it("updates users_private filtered by .eq('user_id', uid)", async () => {
    mockUpdateEq.mockResolvedValue({ error: null });

    await setDateOfBirth('2000-01-01');

    expect(mockUpdate).toHaveBeenCalledWith({ date_of_birth: '2000-01-01' });
    expect(mockUpdateEq).toHaveBeenCalledWith('user_id', USER_ID);
  });
});
