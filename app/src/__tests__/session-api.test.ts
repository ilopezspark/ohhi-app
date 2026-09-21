const mockGetUser = jest.fn();

jest.mock('../api/client', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
  },
}));

import { currentUserId } from '../api/session';

const USER_ID = 'f6f6f6f6-6666-4666-8666-666666666666';

describe('currentUserId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("resolves the signed-in user's id via supabase.auth.getUser()", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });

    await expect(currentUserId()).resolves.toBe(USER_ID);
  });

  it('throws "Not signed in." when there is no user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(currentUserId()).rejects.toThrow('Not signed in.');
  });

  it('rethrows a getUser error', async () => {
    const authError = new Error('network down');
    mockGetUser.mockResolvedValue({ data: { user: null }, error: authError });

    await expect(currentUserId()).rejects.toBe(authError);
  });
});
