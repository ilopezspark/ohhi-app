// Migration 0018 (decision 94): the catalog is read through `tag_catalog()`,
// a user's tags are written only through `set_my_tags(uuid[])` (the direct
// `user_tags` writes are revoked, 42501), and `suggest_tag` queues a
// suggestion without touching the profile. getUserTags() keeps its explicit
// owner filter: `user_tags` is readable by owner OR same-campus, so an
// unfiltered read could return someone else's tags.
const mockGetUser = jest.fn();
const mockOrder = jest.fn();
const mockSelectEq = jest.fn((..._args: unknown[]) => ({ order: mockOrder }));
const mockSelect = jest.fn((..._args: unknown[]) => ({ eq: mockSelectEq }));
const mockDelete = jest.fn();
const mockInsert = jest.fn();
const mockUpdate = jest.fn();
const mockFrom = jest.fn((..._args: unknown[]) => ({ select: mockSelect, delete: mockDelete, insert: mockInsert, update: mockUpdate }));
const mockRpc = jest.fn();

jest.mock('../api/client', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import fs from 'fs';
import path from 'path';
import { getUserTags, listTagCatalog, MAX_TAGS, minTagsToSave, MIN_TAGS, setMyTags, suggestTag } from '../api/tags';
import { InvalidInputError, RefusedError, UnknownError } from '../api/errors';

const USER_ID = 'd4d4d4d4-4444-4444-8444-444444444444';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
});

describe('listTagCatalog', () => {
  it('reads tag_catalog() and keeps its order, mapping the columns', async () => {
    mockRpc.mockResolvedValue({
      data: [
        { id: 'a', label: 'basketball', category: 'sports', category_label: 'sports', category_order: 1, sort_order: 1, campus_type: 'all' },
        { id: 'b', label: 'anime', category: 'film_tv', category_label: 'film & tv', category_order: 4, sort_order: 6, campus_type: 'all' },
      ],
      error: null,
    });
    const tags = await listTagCatalog();
    expect(mockRpc).toHaveBeenCalledWith('tag_catalog');
    expect(mockFrom).not.toHaveBeenCalled();
    expect(tags).toEqual([
      { id: 'a', label: 'basketball', category: 'sports', categoryLabel: 'sports', categoryOrder: 1, sortOrder: 1 },
      { id: 'b', label: 'anime', category: 'film_tv', categoryLabel: 'film & tv', categoryOrder: 4, sortOrder: 6 },
    ]);
  });

  it('returns [] when signed out (no rows)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    expect(await listTagCatalog()).toEqual([]);
  });
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

describe('setMyTags', () => {
  it('writes the whole list, in picked order, through set_my_tags only', async () => {
    mockRpc.mockResolvedValue({ data: ['t2', 't1', 't3'], error: null });
    const stored = await setMyTags(['t2', 't1', 't3']);
    expect(mockRpc).toHaveBeenCalledWith('set_my_tags', { p_tag_ids: ['t2', 't1', 't3'] });
    expect(stored).toEqual(['t2', 't1', 't3']);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('accepts 10 (the old client cap of 3 is gone)', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const ten = Array.from({ length: 10 }, (_, i) => `t${i}`);
    await expect(setMyTags(ten)).resolves.toEqual([]);
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('stops more than 10 before touching the network', async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `t${i}`);
    await expect(setMyTags(eleven)).rejects.toThrow('ten interests at most.');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it.each([
    ['pick at least 3 tags', 'keep at least 3 interests.'],
    ['pick at least 1 tags', 'keep at least 1 interest.'],
    ['unknown tag', "one of those interests isn't offered anymore. pick another one."],
    ['a tag can be picked once', 'each interest can only be picked once.'],
    ['tags must be a flat list', "that didn't work."],
  ])('maps 22023 %p to friendly lowercase copy', async (message, copy) => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '22023', message } });
    const error = await setMyTags(['t1']).catch((e) => e);
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toBe(copy);
  });

  it('keeps 42501 the generic refusal', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'not allowed' } });
    await expect(setMyTags(['t1'])).rejects.toBeInstanceOf(RefusedError);
  });
});

describe('minTagsToSave (mirrors set_my_tags)', () => {
  it('is min(3, held) after onboarding and 0 while onboarding', () => {
    expect(minTagsToSave(0)).toBe(0);
    expect(minTagsToSave(1)).toBe(1);
    expect(minTagsToSave(2)).toBe(2);
    expect(minTagsToSave(3)).toBe(3);
    expect(minTagsToSave(9)).toBe(3);
    expect(minTagsToSave(9, true)).toBe(0);
    expect([MIN_TAGS, MAX_TAGS]).toEqual([3, 10]);
  });
});

describe('suggestTag', () => {
  it('calls suggest_tag with the label and category (or null)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await suggestTag('rollerblading', 'sports');
    expect(mockRpc).toHaveBeenCalledWith('suggest_tag', { p_label: 'rollerblading', p_category: 'sports' });
    await suggestTag('rollerblading');
    expect(mockRpc).toHaveBeenLastCalledWith('suggest_tag', { p_label: 'rollerblading', p_category: null });
  });

  it.each([
    ["that text can't be used", "that text can't be used."],
    ['too many suggestions waiting', 'you already have a few suggestions waiting. try again once they have been looked at.'],
    ['a suggestion must be 40 characters or fewer', 'keep it to 40 characters.'],
    ['letters and numbers only', 'letters and numbers only.'],
  ])('maps 22023 %p to neutral copy that never echoes the text', async (message, copy) => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '22023', message } });
    const error = await suggestTag('something').catch((e) => e);
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toBe(copy);
    expect(error.message).not.toContain('something');
  });

  it('an unexpected failure stays an UnknownError', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } });
    await expect(suggestTag('x')).rejects.toBeInstanceOf(UnknownError);
  });
});

describe('no direct user_tags writes anywhere in src/', () => {
  function listSource(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') out.push(...listSource(full));
      } else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  it('never inserts, updates, upserts or deletes on user_tags (revoked since 0018)', () => {
    const offenders = listSource(path.join(__dirname, '..')).filter((file) => {
      const code = fs.readFileSync(file, 'utf8');
      const pattern = /\.from\(\s*['"]user_tags['"]\s*\)([^;]*)/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(code)) !== null) {
        if (/\.(insert|update|upsert|delete)\(/.test(match[1])) return true;
      }
      return false;
    });
    expect(offenders).toEqual([]);
  });
});
