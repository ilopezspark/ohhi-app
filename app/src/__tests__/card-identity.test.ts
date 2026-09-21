const mockGetSession = jest.fn();

jest.mock('../api/client', () => ({
  supabase: { auth: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
  SUPABASE_URL: 'https://example.test',
}));

import { getIdentity } from '../api/identity';

const USER_ID = '33333333-3333-4333-8333-333333333333';

describe('getIdentity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'jwt-token' } }, error: null });
    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn();
  });

  it('GETs /functions/v1/identity/:user_id with the caller JWT', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      status: 200,
      ok: true,
      json: () => Promise.resolve({ pronouns: 'she/her', orientation: ['bi'], is_public: true, user_id: USER_ID }),
    });

    const result = await getIdentity(USER_ID);

    expect(globalThis.fetch).toHaveBeenCalledWith(`https://example.test/functions/v1/identity/${USER_ID}`, {
      headers: { Authorization: 'Bearer jwt-token' },
    });
    expect(result).toEqual({ pronouns: 'she/her', orientation: ['bi'] });
  });

  it('returns null on 404 — never surfaced as an error, indistinguishable from every other refusal', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({ status: 404, ok: false, json: () => Promise.resolve({}) });

    const result = await getIdentity(USER_ID);

    expect(result).toBeNull();
  });

  it('throws the mapped error on a non-404 failure', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({ status: 500, ok: false, json: () => Promise.resolve({}) });

    await expect(getIdentity(USER_ID)).rejects.toThrow();
  });

  it('defaults orientation to an empty array and pronouns to null when the response omits them', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      status: 200,
      ok: true,
      json: () => Promise.resolve({ user_id: USER_ID, is_public: true }),
    });

    const result = await getIdentity(USER_ID);

    expect(result).toEqual({ pronouns: null, orientation: [] });
  });
});
