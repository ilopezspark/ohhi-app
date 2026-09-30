const mockGetUser = jest.fn();
const mockRpc = jest.fn();
const mockChain: Record<string, jest.Mock> = {};
const mockFrom = jest.fn((..._args: unknown[]) => mockChain);

jest.mock('../api/client', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import { getMyAbout, listPrograms, setMyAbout } from '../api/about';
import { dismissNotice, isProfileMovedNotice, isTagsChangedNotice, listUnseenNotices } from '../api/notices';
import { updateProfile } from '../api/profile';
import { InvalidInputError, mapSupabaseError, RefusedError, UnknownError } from '../api/errors';
import { EMPTY_ABOUT } from '../profile/about';

const USER_ID = 'd4d4d4d4-4444-4444-8444-444444444444';

/** A chainable query builder whose terminal call resolves `result`. */
function chain(result: unknown, terminal: string) {
  for (const key of ['select', 'eq', 'is', 'order', 'update']) {
    mockChain[key] = jest.fn(() => mockChain);
  }
  mockChain[terminal] = jest.fn(() => mockChain);
  // Resolve whichever call ends the chain.
  (mockChain as unknown as { then: unknown }).then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
});

describe('about API', () => {
  it('my_about() is parsed into the app shape', async () => {
    mockRpc.mockResolvedValue({
      data: { major: { id: 'p1', label: 'nursing' }, minor: null, graduating_term: null, graduating_year: null, graduating_unsure: true, work_type: null, job_title: null, work_hours: [] },
      error: null,
    });
    expect(await getMyAbout()).toEqual({ ...EMPTY_ABOUT, major: { id: 'p1', label: 'nursing' }, graduatingUnsure: true });
    expect(mockRpc).toHaveBeenCalledWith('my_about');
  });

  it('set_my_about sends the patch as is and returns the stored section', async () => {
    mockRpc.mockResolvedValue({ data: { work_type: 'retail', work_hours: [] }, error: null });
    const stored = await setMyAbout({ work_type: 'retail' });
    expect(mockRpc).toHaveBeenCalledWith('set_my_about', { p_about: { work_type: 'retail' } });
    expect(stored.workType).toBe('retail');
  });

  it.each([
    ["that text can't be used", "that text can't be used."],
    ['the minor must differ from the major', 'your minor has to be different from your major.'],
    ['graduating year must be between 2026 and 2034', 'pick a year from 2026 to 2034.'],
    ["part time and full time can't both be picked", "part time and full time can't both be picked."],
    ['unknown about field', "that didn't work."],
  ])('maps 22023 %p to lowercase copy', async (message, copy) => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '22023', message } });
    const error = await setMyAbout({ job_title: 'x' }).catch((e) => e);
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toBe(copy);
  });

  it('programs: active only, in sort order then label', async () => {
    chain({ data: [{ id: 'p1', label: 'art', sort_order: 1 }], error: null }, 'order');
    const rows = await listPrograms();
    expect(mockFrom).toHaveBeenCalledWith('programs');
    expect(mockChain.eq).toHaveBeenCalledWith('active', true);
    expect(mockChain.order).toHaveBeenNthCalledWith(1, 'sort_order', { ascending: true });
    expect(mockChain.order).toHaveBeenNthCalledWith(2, 'label', { ascending: true });
    expect(rows).toEqual([{ id: 'p1', label: 'art', sort_order: 1 }]);
  });
});

describe('notices API', () => {
  it("reads the caller's unseen notices, owner-filtered, oldest first, skipping unknown kinds", async () => {
    chain(
      {
        data: [
          { id: 'n1', kind: 'tags_changed', payload: { dropped: ['gym', 'library', 7], major: 'nursing' } },
          { id: 'n2', kind: 'something_new', payload: {} },
        ],
        error: null,
      },
      'order'
    );
    const notices = await listUnseenNotices();
    expect(mockFrom).toHaveBeenCalledWith('user_notices');
    expect(mockChain.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(mockChain.is).toHaveBeenCalledWith('seen_at', null);
    expect(mockChain.order).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(notices).toEqual([{ id: 'n1', kind: 'tags_changed', dropped: ['gym', 'library'], major: 'nursing' }]);
  });

  it('parses profile_moved (migration 0023): field names only, held_back as heldBack, junk dropped', async () => {
    chain(
      {
        data: [
          { id: 'n3', kind: 'profile_moved', payload: { moved: ['interested_in'], held_back: ['pronouns', ''], removed: ['kinks', 3] } },
          { id: 'n4', kind: 'profile_moved', payload: null },
        ],
        error: null,
      },
      'order'
    );
    const notices = await listUnseenNotices();
    expect(notices).toEqual([
      { id: 'n3', kind: 'profile_moved', moved: ['interested_in'], heldBack: ['pronouns'], removed: ['kinks'] },
      { id: 'n4', kind: 'profile_moved', moved: [], heldBack: [], removed: [] },
    ]);
    expect(notices.filter(isProfileMovedNotice)).toHaveLength(2);
    expect(notices.filter(isTagsChangedNotice)).toHaveLength(0);
  });

  it('dismiss_notice returns whether it was newly seen', async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    expect(await dismissNotice('n1')).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('dismiss_notice', { p_id: 'n1' });
    mockRpc.mockResolvedValue({ data: false, error: null });
    expect(await dismissNotice('n1')).toBe(false);
  });
});

describe('the word filter, everywhere', () => {
  it("mapSupabaseError turns the filter's 22023 into the neutral line for every caller", () => {
    const mapped = mapSupabaseError({ code: '22023', message: "that text can't be used" });
    expect(mapped).toBeInstanceOf(InvalidInputError);
    expect(mapped.message).toBe("that text can't be used.");
    // other 22023s stay unknown here (their own modules word them)
    expect(mapSupabaseError({ code: '22023', message: 'at most 3 prompts' })).toBeInstanceOf(UnknownError);
    expect(mapSupabaseError({ code: '42501', message: 'not allowed' })).toBeInstanceOf(RefusedError);
  });

  it('a filtered status line (profiles_guard) and an out-of-range grad year come back worded', async () => {
    chain({ error: { code: '22023', message: "that text can't be used" } }, 'eq');
    const filtered = await updateProfile({ status_line: 'x' }).catch((e) => e);
    expect(filtered).toBeInstanceOf(InvalidInputError);
    expect(filtered.message).toBe("that text can't be used.");

    chain({ error: { code: '22023', message: 'graduating year must be between 2026 and 2034' } }, 'eq');
    const year = await updateProfile({ grad_year: 2040 }).catch((e) => e);
    expect(year.message).toBe('pick a year from 2026 to 2034.');
  });
});
