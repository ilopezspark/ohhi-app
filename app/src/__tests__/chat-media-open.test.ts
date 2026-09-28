/**
 * `api/mediaOpen.ts` — `POST /functions/v1/media-open`, the only read path
 * `chat-media-limited` has (`docs/chat-media-plan.md` §2/§4). Same plain-
 * `fetch` + caller-JWT convention as `api/identity.ts`
 * (`card-identity.test.ts` is this file's sibling).
 */
const mockGetSession = jest.fn();

jest.mock('../api/client', () => ({
  supabase: { auth: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
  SUPABASE_URL: 'https://example.test',
}));

import { openLimitedMedia } from '../api/mediaOpen';

const MESSAGE_ID = 'mmmmmmmm-0000-4000-8000-000000000009';

describe('openLimitedMedia', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'jwt-token' } }, error: null });
    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn();
  });

  it('POSTs {message_id} with the caller JWT', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      status: 200,
      ok: true,
      json: () => Promise.resolve({ url: 'https://signed/x.jpg', kind: 'photo', expires_in: 60, views_remaining: 1 }),
    });

    const result = await openLimitedMedia(MESSAGE_ID);

    expect(globalThis.fetch).toHaveBeenCalledWith('https://example.test/functions/v1/media-open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-token' },
      body: JSON.stringify({ message_id: MESSAGE_ID }),
    });
    expect(result).toEqual({ url: 'https://signed/x.jpg', kind: 'photo', expiresIn: 60, viewsRemaining: 1 });
  });

  it('returns null on 404 — exhausted, not the recipient, and "not deployed yet" all read identically', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({ status: 404, ok: false, json: () => Promise.resolve({}) });
    expect(await openLimitedMedia(MESSAGE_ID)).toBeNull();
  });

  it('returns null rather than throwing when not signed in', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    expect(await openLimitedMedia(MESSAGE_ID)).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns null on a dropped network — no distinguishing copy from any other refusal', async () => {
    (globalThis.fetch as jest.Mock).mockRejectedValue(new Error('network down'));
    expect(await openLimitedMedia(MESSAGE_ID)).toBeNull();
  });

  it('throws the mapped error on a non-404 failure', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({ status: 500, ok: false, json: () => Promise.resolve({}) });
    await expect(openLimitedMedia(MESSAGE_ID)).rejects.toThrow();
  });

  it('defaults expiresIn/viewsRemaining when the response omits them', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      status: 200,
      ok: true,
      json: () => Promise.resolve({ url: 'https://signed/x.jpg', kind: 'video' }),
    });
    expect(await openLimitedMedia(MESSAGE_ID)).toEqual({
      url: 'https://signed/x.jpg',
      kind: 'video',
      expiresIn: 60,
      viewsRemaining: 0,
    });
  });

  it('returns null for a malformed success body rather than throwing', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({ status: 200, ok: true, json: () => Promise.resolve({}) });
    expect(await openLimitedMedia(MESSAGE_ID)).toBeNull();
  });
});
