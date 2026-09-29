/**
 * `api/albumOwner.ts`: the owner's name and first approved photo for the
 * story's header, and the caller's conversation with the owner for the
 * reply bar. Both are best effort and never throw.
 */

type Call = { method: string; args: unknown[] };

const mockCalls: Record<string, Call[]> = {};
const mockResults: Record<string, { data: unknown; error: unknown } | Error> = {};

function mockChain(table: string) {
  mockCalls[table] = [];
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'or', 'order', 'limit', 'maybeSingle']) {
    chain[method] = (...args: unknown[]) => {
      mockCalls[table].push({ method, args });
      return chain;
    };
  }
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
    const result = mockResults[table];
    return result instanceof Error ? Promise.reject(result).then(resolve, reject) : Promise.resolve(result).then(resolve, reject);
  };
  return chain;
}

jest.mock('../api/client', () => ({
  supabase: { from: (table: string) => mockChain(table) },
  SUPABASE_URL: 'https://example.test',
}));
jest.mock('../api/conversations', () => ({ currentUserId: jest.fn() }));

import { currentUserId } from '../api/conversations';
import { findConversationIdWith, getAlbumOwner } from '../api/albumOwner';

const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const OWNER = 'bbbbbbbb-0000-4000-8000-000000000002';

beforeEach(() => {
  for (const key of Object.keys(mockCalls)) delete mockCalls[key];
  for (const key of Object.keys(mockResults)) delete mockResults[key];
  (currentUserId as jest.Mock).mockResolvedValue(ME);
});

describe('getAlbumOwner', () => {
  it('reads the first name and the lowest-position approved photo', async () => {
    mockResults.profiles = { data: { first_name: 'Maya' }, error: null };
    mockResults.user_photos = { data: [{ storage_path: `${OWNER}/1.jpg` }], error: null };
    await expect(getAlbumOwner(OWNER)).resolves.toEqual({ firstName: 'Maya', photoPath: `${OWNER}/1.jpg` });
    expect(mockCalls.profiles).toEqual(
      expect.arrayContaining([
        { method: 'select', args: ['first_name'] },
        { method: 'eq', args: ['id', OWNER] },
      ])
    );
    expect(mockCalls.user_photos).toEqual([
      { method: 'select', args: ['storage_path'] },
      { method: 'eq', args: ['user_id', OWNER] },
      { method: 'eq', args: ['moderation_state', 'ok'] },
      { method: 'order', args: ['position', { ascending: true }] },
      { method: 'limit', args: [1] },
    ]);
  });

  it('a refused or failing read is just no name and no photo, never a throw', async () => {
    mockResults.profiles = { data: null, error: { code: '42501' } };
    mockResults.user_photos = new Error('network');
    await expect(getAlbumOwner(OWNER)).resolves.toEqual({ firstName: null, photoPath: null });
  });
});

describe('findConversationIdWith', () => {
  it('finds the newest conversation between exactly the two of us', async () => {
    mockResults.conversations = { data: [{ id: 'conv-1' }], error: null };
    await expect(findConversationIdWith(OWNER)).resolves.toBe('conv-1');
    expect(mockCalls.conversations).toEqual([
      { method: 'select', args: ['id'] },
      {
        method: 'or',
        args: [`and(user_a_id.eq.${ME},user_b_id.eq.${OWNER}),and(user_a_id.eq.${OWNER},user_b_id.eq.${ME})`],
      },
      { method: 'order', args: ['created_at', { ascending: false }] },
      { method: 'limit', args: [1] },
    ]);
  });

  it('none, refused, myself or anything that is not a bare uuid: null, and no read for the last two', async () => {
    mockResults.conversations = { data: [], error: null };
    await expect(findConversationIdWith(OWNER)).resolves.toBeNull();
    mockResults.conversations = { data: null, error: { code: '42501' } };
    await expect(findConversationIdWith(OWNER)).resolves.toBeNull();

    delete mockCalls.conversations;
    await expect(findConversationIdWith(ME)).resolves.toBeNull();
    await expect(findConversationIdWith('x),or(user_a_id.neq.0')).resolves.toBeNull();
    expect(mockCalls.conversations).toBeUndefined();
  });
});
