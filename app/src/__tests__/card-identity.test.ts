const mockGetSession = jest.fn();
const mockGetUser = jest.fn();

jest.mock('../api/client', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      getUser: (...args: unknown[]) => mockGetUser(...args),
    },
  },
  SUPABASE_URL: 'https://example.test',
}));

import { getIdentity, getMyIdentity } from '../api/identity';

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
    // v2 shape; the transitional v1 keys still come through for pre-v2 screens.
    expect(result).toMatchObject({ user_id: USER_ID, pronouns: 'she/her', orientation: ['bi'], is_public: true });
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

    expect(result).toMatchObject({ pronouns: null, orientation: [], cards: {} });
  });
});

/**
 * Profile restructure, phase 4b: what the profile renders. A viewer's
 * profile renders `getIdentity(targetId).cards` exactly as returned (the
 * function already dropped every card the audience withholds); the owner's
 * preview renders `getMyIdentity()` (every card, plus audiences).
 */
describe('identity cards for the profile view', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'jwt-token' } }, error: null });
    mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn();
  });

  it('getIdentity (a viewer): only the cards that came back, no audiences', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      status: 200,
      ok: true,
      json: () =>
        Promise.resolve({
          user_id: USER_ID,
          cards: {
            identity: { pronouns: ['she/her'], orientation: [], interested_in: [], relationship: 'single' },
            before_you_message: { photos_content: ["don't screenshot"] },
          },
          pronouns: 'she/her',
          orientation: [],
        }),
    });

    const result = await getIdentity(USER_ID);

    expect(Object.keys(result!.cards)).toEqual(['identity', 'before_you_message']);
    expect(result!.cards.identity?.relationship).toBe('single');
    expect(result!.cards.before_you_message?.photos_content).toEqual(["don't screenshot"]);
    expect(result!.audiences).toBeNull();
  });

  it('getMyIdentity (the owner): every card, filled or not, and the audiences', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      status: 200,
      ok: true,
      json: () =>
        Promise.resolve({
          user_id: USER_ID,
          cards: { lifestyle: { drinking: 'rarely', smoking: null, four_twenty: null, kids: null } },
          audiences: { identity: 'everyone', background: 'after_hi', lifestyle: 'only_me', around: 'everyone' },
          is_public: true,
        }),
    });

    const result = await getMyIdentity();

    expect(globalThis.fetch).toHaveBeenCalledWith(`https://example.test/functions/v1/identity/${USER_ID}`, expect.anything());
    expect(Object.keys(result.cards)).toEqual(['identity', 'background', 'lifestyle', 'around', 'before_you_message']);
    expect(result.cards.lifestyle.drinking).toBe('rarely');
    expect(result.audiences).toEqual({ identity: 'everyone', background: 'after_hi', lifestyle: 'only_me', around: 'everyone' });
  });

  it('getMyIdentity on the owner 404 (never written): every card empty, every audience everyone', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({ status: 404, ok: false, json: () => Promise.resolve({}) });

    const result = await getMyIdentity();

    expect(result.cards.identity.pronouns).toEqual([]);
    expect(result.audiences).toEqual({ identity: 'everyone', background: 'everyone', lifestyle: 'everyone', around: 'everyone' });
  });
});
