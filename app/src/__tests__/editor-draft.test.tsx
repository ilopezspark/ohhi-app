import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// api/*.ts import the real supabase client (via ./client), which throws
// outside a real Expo config-eval context (no Constants.expoConfig under
// Jest) — mocked out so the requireActual-free mocks below never touch it,
// same as me-root-usemedata.test.tsx's own setup.
jest.mock('../api/client', () => ({ supabase: {} }));

jest.mock('../api/me', () => ({ me: jest.fn() }));
jest.mock('../api/profile', () => ({
  getFirstName: jest.fn(),
  getGradYear: jest.fn(),
  getStatusLine: jest.fn(),
  updateProfile: jest.fn(),
}));
jest.mock('../api/goals', () => ({ getUserGoals: jest.fn(), setUserGoals: jest.fn() }));
jest.mock('../api/tags', () => ({
  getUserTags: jest.fn(),
  setMyTags: jest.fn(),
  listTagCatalog: jest.fn(),
  minTagsToSave: (held: number) => Math.min(3, Math.max(0, held)),
}));
jest.mock('../api/about', () => ({ getMyAbout: jest.fn(), setMyAbout: jest.fn() }));
jest.mock('../api/photos', () => ({ listMyPhotos: jest.fn() }));
jest.mock('../api/profileFields', () => ({
  getMyProfileFields: jest.fn(),
  setMyPlaceLine: jest.fn(),
  setMyUsualPlaces: jest.fn(),
  setMyPrompts: jest.fn(),
}));

import { me } from '../api/me';
import { getFirstName, getGradYear, getStatusLine, updateProfile } from '../api/profile';
import { getUserGoals, setUserGoals } from '../api/goals';
import { getUserTags, setMyTags as setUserTags, listTagCatalog } from '../api/tags';
import { getMyAbout, setMyAbout } from '../api/about';
import { EMPTY_ABOUT, type AboutSection } from '../profile/about';
import { listMyPhotos } from '../api/photos';
import { getMyProfileFields, setMyPlaceLine, setMyPrompts, setMyUsualPlaces } from '../api/profileFields';
import { InvalidInputError } from '../api/errors';
import { useProfileEditorDraft } from '../me/editor/useProfileEditorDraft';
import { profileCompletion, sectionWeight } from '../profile/completion';
import { queryKeys } from '../me/queryKeys';

function baseMe(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'u1',
    status: 'active',
    verification_status: 'verified',
    campus_id: 'c1',
    campus_slug: 'clc',
    campus_label: 'College of Lake County',
    here_now: false,
    goals_count: 1,
    tags_count: 1,
    photos_count: 2,
    ...overrides,
  };
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const CATALOG = [
  { id: 't1', label: 'coffee', category: 'food_drink', categoryLabel: 'food & drink', categoryOrder: 8, sortOrder: 4 },
  { id: 't2', label: 'gym', category: 'fitness', categoryLabel: 'fitness', categoryOrder: 2, sortOrder: 1 },
];

const BASE_ABOUT: AboutSection = {
  ...EMPTY_ABOUT,
  major: { id: 'p1', label: 'nursing' },
  graduatingTerm: 'spring',
  graduatingYear: 2027,
};

beforeEach(() => {
  jest.clearAllMocks();
  (me as jest.Mock).mockResolvedValue(baseMe());
  (getFirstName as jest.Mock).mockResolvedValue('izaac');
  (getGradYear as jest.Mock).mockResolvedValue(2027);
  (getStatusLine as jest.Mock).mockResolvedValue('at the library');
  (getUserGoals as jest.Mock).mockResolvedValue(['friends']);
  (getUserTags as jest.Mock).mockResolvedValue([{ tag_id: 't1', position: 0 }]);
  (listTagCatalog as jest.Mock).mockResolvedValue(CATALOG);
  (getMyAbout as jest.Mock).mockResolvedValue(BASE_ABOUT);
  (setMyAbout as jest.Mock).mockImplementation(async () => BASE_ABOUT);
  (listMyPhotos as jest.Mock).mockResolvedValue([{ position: 0 }, { position: 1 }]);
  (updateProfile as jest.Mock).mockResolvedValue(undefined);
  (setUserGoals as jest.Mock).mockResolvedValue(undefined);
  (setUserTags as jest.Mock).mockImplementation(async (ids: string[]) => ids);
  (getMyProfileFields as jest.Mock).mockResolvedValue(baseFields());
  (setMyPlaceLine as jest.Mock).mockResolvedValue('2026-09-29T20:00:00Z');
  (setMyUsualPlaces as jest.Mock).mockImplementation(async (places: string[]) => places);
  (setMyPrompts as jest.Mock).mockResolvedValue([]);
});

function baseFields(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    placeLine: 'library, 2nd floor',
    placeLineUntil: '2026-09-29T20:00:00Z',
    placeLineShown: true,
    usualPlaces: ['library'],
    prompts: [{ position: 0, promptId: 'cafe_order', question: 'my order at the campus cafe', gated: false, answer: 'oat latte' }],
    joinedMonth: '2026-09-01',
    joinedRecency: 'yesterday',
    ...overrides,
  };
}

describe('useProfileEditorDraft — loading and identity fields', () => {
  it('seeds the draft from the loaded status/goals/tags exactly once everything resolves', async () => {
    const { result } = await renderHook(() => useProfileEditorDraft(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.draft).toEqual({
      statusLine: 'at the library',
      goals: ['friends'],
      tagIds: ['t1'],
      placeLine: 'library, 2nd floor',
      usualPlaces: ['library'],
      prompts: [{ promptId: 'cafe_order', question: 'my order at the campus cafe', gated: false, answer: 'oat latte' }],
      about: BASE_ABOUT,
    });
    expect(result.current.dirty).toBe(false);
  });

  it('passes through firstName, gradYear, campusShort (uppercased slug), verified, userId, photoCount', async () => {
    const { result } = await renderHook(() => useProfileEditorDraft(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.firstName).toBe('izaac');
    expect(result.current.gradYear).toBe(2027);
    expect(result.current.campusShort).toBe('CLC');
    expect(result.current.verified).toBe(true);
    expect(result.current.userId).toBe('u1');
    expect(result.current.photoCount).toBe(2);
  });

  it('reports unverified when verification_status is not verified', async () => {
    (me as jest.Mock).mockResolvedValue(baseMe({ verification_status: 'unverified' }));
    const { result } = await renderHook(() => useProfileEditorDraft(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.verified).toBe(false);
  });
});

describe('useProfileEditorDraft — completion', () => {
  it('computes completion identically to profile/completion.ts#profileCompletion for the same inputs', async () => {
    const { result } = await renderHook(() => useProfileEditorDraft(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // One interest held: tags only count from 3 on (migration 0018).
    const expected = profileCompletion({ photoCount: 2, hasStatus: true, hasHereFor: true, tagCount: 1 });
    expect(result.current.completion.percent).toBe(expected.percent);
  });

  it('the per-section weight shown for an incomplete section matches sectionWeight()', async () => {
    (getStatusLine as jest.Mock).mockResolvedValue(null);
    (getUserGoals as jest.Mock).mockResolvedValue([]);
    (listMyPhotos as jest.Mock).mockResolvedValue([{ position: 0 }]);

    const { result } = await renderHook(() => useProfileEditorDraft(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const input = {
      photoCount: result.current.photoCount,
      hasStatus: result.current.draft.statusLine.trim().length > 0,
      hasHereFor: result.current.draft.goals.length > 0,
      tagCount: result.current.draft.tagIds.length,
    };

    expect(sectionWeight('photos', input)).toBe(20); // photo1 filled, photo2 missing
    expect(sectionWeight('status', input)).toBe(10);
    expect(sectionWeight('hereFor', input)).toBe(10);
    expect(sectionWeight('tags', input)).toBe(10); // one interest held: tags count from 3 on
  });

  it('editing the draft (before saving) updates the completion picture immediately', async () => {
    (getUserGoals as jest.Mock).mockResolvedValue([]);
    const { result } = await renderHook(() => useProfileEditorDraft(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.completion.items.find((i) => i.key === 'hereFor')?.done).toBe(false);

    await act(async () => {
      result.current.setGoals(['friends']);
    });
    await waitFor(() => expect(result.current.completion.items.find((i) => i.key === 'hereFor')?.done).toBe(true));
  });
});

describe('useProfileEditorDraft — dirty / discard', () => {
  it('is dirty after any draft field changes, and clean again after discard', async () => {
    const { result } = await renderHook(() => useProfileEditorDraft(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.setStatusLine('new status');
    });
    await waitFor(() => expect(result.current.dirty).toBe(true));

    await act(async () => {
      result.current.discard();
    });
    await waitFor(() => expect(result.current.dirty).toBe(false));
    expect(result.current.draft.statusLine).toBe('at the library');
  });

  it('goal-set comparison ignores order (dirty only reflects an actual set difference)', async () => {
    (getUserGoals as jest.Mock).mockResolvedValue(['friends', 'study']);
    const { result } = await renderHook(() => useProfileEditorDraft(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.setGoals(['study', 'friends']);
    });
    await waitFor(() => expect(result.current.dirty).toBe(false));
  });

  it('tag order DOES matter for dirty (tags are positioned)', async () => {
    (getUserTags as jest.Mock).mockResolvedValue([
      { tag_id: 't1', position: 0 },
      { tag_id: 't2', position: 1 },
    ]);
    const { result } = await renderHook(() => useProfileEditorDraft(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.setTagIds(['t2', 't1']);
    });
    await waitFor(() => expect(result.current.dirty).toBe(true));
  });
});

describe('useProfileEditorDraft — commit (all-or-report)', () => {
  it('is a no-op when nothing changed', async () => {
    const { result } = await renderHook(() => useProfileEditorDraft(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.commit();
    });

    expect(ok).toBe(true);
    expect(updateProfile).not.toHaveBeenCalled();
    expect(setUserGoals).not.toHaveBeenCalled();
    expect(setUserTags).not.toHaveBeenCalled();
  });

  it('writes only the fields that changed, in parallel, and invalidates their shared query keys on success', async () => {
    const client = makeClient();
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries');
    const { result } = await renderHook(() => useProfileEditorDraft(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.setStatusLine('new status');
    });
    await waitFor(() => expect(result.current.dirty).toBe(true));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.commit();
    });

    expect(ok).toBe(true);
    expect(updateProfile).toHaveBeenCalledWith({ status_line: 'new status' });
    expect(setUserGoals).not.toHaveBeenCalled();
    expect(setUserTags).not.toHaveBeenCalled();
    expect(result.current.dirty).toBe(false);

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: readonly unknown[] }).queryKey);
    expect(invalidatedKeys).toContainEqual(queryKeys.me.status);
  });

  it('empties the status line to null rather than an empty string', async () => {
    const { result } = await renderHook(() => useProfileEditorDraft(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.setStatusLine('   ');
    });
    await act(async () => {
      await result.current.commit();
    });

    expect(updateProfile).toHaveBeenCalledWith({ status_line: null });
  });

  it('all-or-report: a failed field stays dirty and in the draft; a succeeded field commits and is not resent', async () => {
    (setUserGoals as jest.Mock).mockRejectedValue(new Error('refused'));
    const { result } = await renderHook(() => useProfileEditorDraft(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.setStatusLine('new status');
      result.current.setGoals(['whatever']);
    });
    await waitFor(() => expect(result.current.dirty).toBe(true));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.commit();
    });

    expect(ok).toBe(false);
    expect(result.current.saveError).toBeTruthy();
    // status succeeded -> no longer dirty for that field; goals failed -> still dirty overall.
    expect(result.current.dirty).toBe(true);
    expect(result.current.draft.statusLine).toBe('new status');
    expect(result.current.draft.goals).toEqual(['whatever']);

    // A retry only resends the field that actually failed.
    (setUserGoals as jest.Mock).mockResolvedValue(undefined);
    await act(async () => {
      ok = await result.current.commit();
    });

    expect(ok).toBe(true);
    expect(updateProfile).toHaveBeenCalledTimes(1);
    expect(setUserGoals).toHaveBeenCalledTimes(2);
    expect(result.current.dirty).toBe(false);
  });
});

describe('useProfileEditorDraft — migration 0015 fields', () => {
  async function loaded(client = makeClient()) {
    const hook = await renderHook(() => useProfileEditorDraft(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    return hook;
  }

  it('exposes the read-only side of my_profile_fields', async () => {
    const { result } = await loaded();
    expect(result.current.fieldsMeta).toEqual({
      savedPlaceLine: 'library, 2nd floor',
      placeLineUntil: '2026-09-29T20:00:00Z',
      placeLineShown: true,
      joinedMonth: '2026-09-01',
      joinedRecency: 'yesterday',
    });
  });

  it('a failed my_profile_fields read is a load error, never an empty draft that would overwrite on done', async () => {
    (getMyProfileFields as jest.Mock).mockRejectedValue(new Error('down'));
    const { result } = await renderHook(() => useProfileEditorDraft(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.loadError).toBeTruthy());
    expect(result.current.ready).toBe(false);
  });

  it('writes each changed field through its RPC, trimmed, and invalidates profile_fields', async () => {
    const client = makeClient();
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries');
    const { result } = await loaded(client);

    await act(async () => {
      result.current.setPlaceLine('  student union  ');
      result.current.setUsualPlaces([' library ', '', 'the gym']);
      result.current.setPrompts([
        { promptId: 'find_me_on_campus', question: "you'll find me on campus at", gated: true, answer: ' the second floor ' },
        { promptId: 'cafe_order', question: 'my order at the campus cafe', gated: false, answer: 'oat latte' },
      ]);
    });
    await waitFor(() => expect(result.current.dirty).toBe(true));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.commit();
    });

    expect(ok).toBe(true);
    expect(setMyPlaceLine).toHaveBeenCalledWith('student union');
    expect(setMyUsualPlaces).toHaveBeenCalledWith(['library', 'the gym']);
    expect(setMyPrompts).toHaveBeenCalledWith([
      { promptId: 'find_me_on_campus', answer: 'the second floor' },
      { promptId: 'cafe_order', answer: 'oat latte' },
    ]);
    expect(updateProfile).not.toHaveBeenCalled();
    expect(result.current.dirty).toBe(false);
    const keys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: readonly unknown[] }).queryKey);
    expect(keys).toContainEqual(queryKeys.me.profileFields);
  });

  it('clearing: a blank place line is sent as null, an empty list as []', async () => {
    const { result } = await loaded();
    await act(async () => {
      result.current.setPlaceLine('   ');
      result.current.setUsualPlaces([]);
      result.current.setPrompts([]);
    });
    await act(async () => {
      await result.current.commit();
    });
    expect(setMyPlaceLine).toHaveBeenCalledWith(null);
    expect(setMyUsualPlaces).toHaveBeenCalledWith([]);
    expect(setMyPrompts).toHaveBeenCalledWith([]);
  });

  it('prompt order matters for dirty; an unchanged place line is not re-sent', async () => {
    (getMyProfileFields as jest.Mock).mockResolvedValue(
      baseFields({
        prompts: [
          { position: 0, promptId: 'a', question: 'q a', gated: false, answer: 'x' },
          { position: 1, promptId: 'b', question: 'q b', gated: false, answer: 'y' },
        ],
      })
    );
    const { result } = await loaded();
    const [a, b] = result.current.draft.prompts;
    await act(async () => {
      result.current.setPrompts([b, a]);
    });
    await waitFor(() => expect(result.current.dirty).toBe(true));
    await act(async () => {
      await result.current.commit();
    });
    expect(setMyPrompts).toHaveBeenCalledWith([
      { promptId: 'b', answer: 'y' },
      { promptId: 'a', answer: 'x' },
    ]);
    expect(setMyPlaceLine).not.toHaveBeenCalled();
  });

  it('refreshPlaceLine re-sends the same line (restarting its two hours), once', async () => {
    (getMyProfileFields as jest.Mock).mockResolvedValue(baseFields({ placeLineShown: false }));
    const { result } = await loaded();
    await act(async () => {
      result.current.refreshPlaceLine();
    });
    await waitFor(() => expect(result.current.dirty).toBe(true));
    await act(async () => {
      await result.current.commit();
    });
    expect(setMyPlaceLine).toHaveBeenCalledWith('library, 2nd floor');
    expect(result.current.dirty).toBe(false);
    await act(async () => {
      await result.current.commit();
    });
    expect(setMyPlaceLine).toHaveBeenCalledTimes(1);
  });

  it('shows the mapped reason for bad input (22023), and keeps the field dirty', async () => {
    (setMyUsualPlaces as jest.Mock).mockRejectedValue(new InvalidInputError('that place is already on your list.'));
    const { result } = await loaded();
    await act(async () => {
      result.current.setUsualPlaces(['library', 'Library']);
    });
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.commit();
    });
    expect(ok).toBe(false);
    expect(result.current.saveError).toBe('that place is already on your list.');
    expect(result.current.dirty).toBe(true);
  });

  it('other failures keep the generic lowercase line', async () => {
    (setMyPrompts as jest.Mock).mockRejectedValue(new Error('network'));
    const { result } = await loaded();
    await act(async () => {
      result.current.setPrompts([]);
    });
    await act(async () => {
      await result.current.commit();
    });
    expect(result.current.saveError).toBe("that didn't work.");
  });

  it('none of the new fields changes completion (the weights are a ruling)', async () => {
    const { result } = await loaded();
    const before = result.current.completion.percent;
    await act(async () => {
      result.current.setPlaceLine('');
      result.current.setUsualPlaces([]);
      result.current.setPrompts([]);
    });
    expect(result.current.completion.percent).toBe(before);
    expect(result.current.completion.items.map((i) => i.key)).not.toEqual(
      expect.arrayContaining(['prompts', 'place', 'usualPlaces'])
    );
  });
});

describe('useProfileEditorDraft — tag catalog and the tag minimum (migration 0018)', () => {
  it('reads tag_catalog() and exposes it', async () => {
    const { result } = await renderHook(() => useProfileEditorDraft(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listTagCatalog).toHaveBeenCalled();
    expect(result.current.catalog).toEqual(CATALOG);
  });

  it('minTags mirrors set_my_tags: min(3, held)', async () => {
    const { result } = await renderHook(() => useProfileEditorDraft(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.savedTagCount).toBe(1);
    expect(result.current.minTags).toBe(1);
  });

  it('saves tags through set_my_tags in picked order', async () => {
    const { result } = await renderHook(() => useProfileEditorDraft(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      result.current.setTagIds(['t2', 't1']);
    });
    await act(async () => {
      await result.current.commit();
    });
    expect(setUserTags).toHaveBeenCalledWith(['t2', 't1']);
  });
});

describe('useProfileEditorDraft — about section (migration 0018)', () => {
  it('sends only the changed about keys through set_my_about and folds the returned section in', async () => {
    const stored: AboutSection = { ...BASE_ABOUT, workType: 'retail', jobTitle: 'cashier' };
    (setMyAbout as jest.Mock).mockResolvedValue(stored);
    const client = makeClient();
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries');
    const { result } = await renderHook(() => useProfileEditorDraft(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.setAbout({ ...BASE_ABOUT, workType: 'retail', jobTitle: ' cashier ' });
    });
    await waitFor(() => expect(result.current.dirty).toBe(true));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.commit();
    });

    expect(ok).toBe(true);
    expect(setMyAbout).toHaveBeenCalledWith({ work_type: 'retail', job_title: 'cashier' });
    expect(updateProfile).not.toHaveBeenCalled();
    expect(result.current.draft.about).toEqual(stored);
    expect(result.current.dirty).toBe(false);
    const keys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: readonly unknown[] }).queryKey);
    expect(keys).toContainEqual(queryKeys.me.aboutSection);
  });

  it('gradYear follows the draft about section', async () => {
    const { result } = await renderHook(() => useProfileEditorDraft(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.gradYear).toBe(2027);
    await act(async () => {
      result.current.setAbout({ ...BASE_ABOUT, graduatingUnsure: true, graduatingYear: null, graduatingTerm: null });
    });
    expect(result.current.gradYear).toBeNull();
  });
});

describe('useProfileEditorDraft — word filter refusals stay on the field', () => {
  const FILTERED = "that text can't be used.";

  it('a filtered status shows the neutral line on that field, keeps the text, and clears once edited', async () => {
    (updateProfile as jest.Mock).mockRejectedValue(new InvalidInputError(FILTERED));
    const { result } = await renderHook(() => useProfileEditorDraft(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.setStatusLine('call me 555 123 4567');
    });
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.commit();
    });

    expect(ok).toBe(false);
    expect(result.current.fieldErrors.statusLine).toBe(FILTERED);
    expect(result.current.draft.statusLine).toBe('call me 555 123 4567');
    expect(result.current.dirty).toBe(true);

    await act(async () => {
      result.current.setStatusLine('at the library');
    });
    expect(result.current.fieldErrors.statusLine).toBeUndefined();
  });

  it('a filtered job title lands on the about field and keeps the text', async () => {
    (setMyAbout as jest.Mock).mockRejectedValue(new InvalidInputError(FILTERED));
    const { result } = await renderHook(() => useProfileEditorDraft(), { wrapper: wrapperFor(makeClient()) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      result.current.setAbout({ ...BASE_ABOUT, jobTitle: 'some words here' });
    });
    await act(async () => {
      await result.current.commit();
    });
    expect(result.current.fieldErrors.about).toBe(FILTERED);
    expect(result.current.draft.about.jobTitle).toBe('some words here');
  });
});
