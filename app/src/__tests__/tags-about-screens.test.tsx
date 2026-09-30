import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
  useNavigation: () => ({ dispatch: jest.fn() }),
}));
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }));
jest.mock('../api/client', () => ({ supabase: {} }));
jest.mock('../api/tags', () => ({
  ...jest.requireActual('../api/tags'),
  listTagCatalog: jest.fn(),
  getUserTags: jest.fn(),
  setMyTags: jest.fn(),
  suggestTag: jest.fn(),
}));
jest.mock('../api/about', () => ({ getMyAbout: jest.fn(), setMyAbout: jest.fn(), listPrograms: jest.fn() }));
jest.mock('../api/notices', () => ({ listUnseenNotices: jest.fn(), dismissNotice: jest.fn() }));
jest.mock('../me/editor/ProfileEditorDraftContext', () => ({ useProfileEditorDraftContext: jest.fn() }));

import { router } from 'expo-router';
import { getUserTags, listTagCatalog, setMyTags, type Tag } from '../api/tags';
import { getMyAbout, listPrograms, setMyAbout } from '../api/about';
import { dismissNotice, listUnseenNotices } from '../api/notices';
import { InvalidInputError } from '../api/errors';
import { useProfileEditorDraftContext } from '../me/editor/ProfileEditorDraftContext';
import { EMPTY_ABOUT, type AboutSection } from '../profile/about';
import { queryKeys } from '../me/queryKeys';
import TagsScreen from '../app/(onboarding)/tags';
import SchoolAndWorkScreen from '../app/profile-editor/school-and-work';
import EditTagsScreen from '../app/profile-editor/tags';
import { TagsChangedNotice, tagsChangedCopy } from '../notices/TagsChangedNotice';

const CATALOG: Tag[] = ['coffee', 'gym', 'anime', 'hiking'].map((label, i) => ({
  id: `t${i}`,
  label,
  category: 'food_drink',
  categoryLabel: 'food & drink',
  categoryOrder: 1,
  sortOrder: i,
}));
const PROGRAMS = [
  { id: 'p-art', label: 'art', sort_order: 1 },
  { id: 'p-nursing', label: 'nursing', sort_order: 2 },
];

function withClient(ui: ReactElement, seed?: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  seed?.(client);
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (listTagCatalog as jest.Mock).mockResolvedValue(CATALOG);
  (getUserTags as jest.Mock).mockResolvedValue([]);
  (setMyTags as jest.Mock).mockImplementation(async (ids: string[]) => ids);
  (getMyAbout as jest.Mock).mockResolvedValue(EMPTY_ABOUT);
  (setMyAbout as jest.Mock).mockImplementation(async (patch: { major_id?: string }) => ({
    ...EMPTY_ABOUT,
    major: patch.major_id ? { id: patch.major_id, label: 'nursing' } : null,
  }));
  (listPrograms as jest.Mock).mockResolvedValue(PROGRAMS);
});
afterEach(() => alertSpy.mockRestore());

describe('onboarding tag step (migration 0018)', () => {
  it('uses the picker: no skip, continue disabled below 3, saves in picked order through set_my_tags', async () => {
    const screen = await withClient(<TagsScreen />);
    await screen.findByTestId('tags-picker');
    expect(screen.queryByTestId('tags-skip')).toBeNull();
    expect(screen.getByTestId('tags-picker-submit')).toHaveTextContent('continue · 0 of 10');

    await fireEvent.press(screen.getByTestId('tags-picker-chip-t2'));
    await fireEvent.press(screen.getByTestId('tags-picker-chip-t0'));
    await fireEvent.press(screen.getByTestId('tags-picker-submit'));
    expect(setMyTags).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('tags-picker-chip-t3'));
    await fireEvent.press(screen.getByTestId('tags-picker-submit'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/(onboarding)/status'));
    expect(setMyTags).toHaveBeenCalledWith(['t2', 't0', 't3']);
    expect(setMyAbout).not.toHaveBeenCalled();
  });

  it('collects the major in the same place, from the campus program list, saved through set_my_about', async () => {
    (getUserTags as jest.Mock).mockResolvedValue([
      { tag_id: 't0', position: 0 },
      { tag_id: 't1', position: 1 },
      { tag_id: 't2', position: 2 },
    ]);
    const screen = await withClient(<TagsScreen />);
    await fireEvent.press(await screen.findByTestId('tags-major-row'));
    await fireEvent.press(await screen.findByTestId('tags-major-sheet-p-nursing'));
    expect(screen.getByTestId('tags-major-row')).toHaveTextContent(/nursing/);
    await fireEvent.press(screen.getByTestId('tags-picker-submit'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/(onboarding)/status'));
    expect(setMyTags).toHaveBeenCalledWith(['t0', 't1', 't2']);
    expect(setMyAbout).toHaveBeenCalledWith({ major_id: 'p-nursing' });
  });

  it('shows a refused save and stays on the step', async () => {
    (getUserTags as jest.Mock).mockResolvedValue([
      { tag_id: 't0', position: 0 },
      { tag_id: 't1', position: 1 },
      { tag_id: 't2', position: 2 },
    ]);
    (setMyTags as jest.Mock).mockRejectedValue(new InvalidInputError("one of those interests isn't offered anymore. pick another one."));
    const screen = await withClient(<TagsScreen />);
    await fireEvent.press(await screen.findByTestId('tags-picker-submit'));
    expect(await screen.findByTestId('tags-picker-error')).toHaveTextContent(/isn't offered anymore/);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('back returns to the photo step', async () => {
    const screen = await withClient(<TagsScreen />);
    await fireEvent.press(await screen.findByTestId('tags-back'));
    expect(router.replace).toHaveBeenCalledWith('/(onboarding)/photo');
  });
});

function draftState(about: AboutSection, overrides: Record<string, unknown> = {}) {
  return {
    catalog: CATALOG,
    minTags: 1,
    fieldErrors: {},
    draft: { statusLine: '', goals: [], tagIds: ['t1'], placeLine: '', usualPlaces: [], prompts: [], about },
    setAbout: jest.fn(),
    setTagIds: jest.fn(),
    ...overrides,
  };
}

describe('/profile-editor/school-and-work', () => {
  function renderEditor(about: AboutSection = EMPTY_ABOUT, overrides: Record<string, unknown> = {}) {
    const state = draftState(about, overrides);
    (useProfileEditorDraftContext as jest.Mock).mockReturnValue(state);
    const screen = withClient(<SchoolAndWorkScreen />, (client) => client.setQueryData(queryKeys.me.programs, PROGRAMS));
    return { state, screen };
  }

  it('picks a major and a minor that differs from it; the minor waits for a major', async () => {
    const { state, screen: pending } = renderEditor();
    const screen = await pending;
    expect(screen.getByTestId('editor-school-work-minor').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByTestId('editor-school-work-major'));
    await fireEvent.press(screen.getByTestId('editor-school-work-major-sheet-p-nursing'));
    await fireEvent.press(screen.getByTestId('editor-school-work-minor'));
    // the major is not offered as a minor
    expect(screen.queryByTestId('editor-school-work-minor-sheet-p-nursing')).toBeNull();
    await fireEvent.press(screen.getByTestId('editor-school-work-minor-sheet-p-art'));
    await fireEvent.press(screen.getByTestId('editor-school-work-save'));
    expect(state.setAbout).toHaveBeenCalledWith(
      expect.objectContaining({ major: { id: 'p-nursing', label: 'nursing' }, minor: { id: 'p-art', label: 'art' } })
    );
  });

  it('not sure yet and a term/year are mutually exclusive; the years run this year .. +8', async () => {
    const { state, screen: pending } = renderEditor({ ...EMPTY_ABOUT, graduatingTerm: 'spring', graduatingYear: new Date().getFullYear() + 2 });
    const screen = await pending;
    const thisYear = new Date().getFullYear();
    expect(screen.getByTestId(`editor-school-work-year-${thisYear}`)).toBeTruthy();
    expect(screen.getByTestId(`editor-school-work-year-${thisYear + 8}`)).toBeTruthy();
    expect(screen.queryByTestId(`editor-school-work-year-${thisYear + 9}`)).toBeNull();
    expect(screen.queryByTestId(`editor-school-work-year-${thisYear - 1}`)).toBeNull();

    await fireEvent(screen.getByTestId('editor-school-work-unsure'), 'onValueChange', true);
    expect(screen.queryByTestId('editor-school-work-term')).toBeNull();
    await fireEvent.press(screen.getByTestId('editor-school-work-save'));
    expect(state.setAbout).toHaveBeenCalledWith(
      expect.objectContaining({ graduatingUnsure: true, graduatingYear: null, graduatingTerm: null })
    );
  });

  it('work: one type, a 48-character title with a counter, and up to 3 hours with part/full time exclusive', async () => {
    const { state, screen: pending } = renderEditor();
    const screen = await pending;
    await fireEvent.press(screen.getByTestId('editor-school-work-type-food_service'));
    await fireEvent.changeText(screen.getByTestId('editor-school-work-title-input'), 'barista');
    expect(screen.getByTestId('editor-school-work-title-input').props.maxLength).toBe(48);
    expect(screen.getByText('7 of 48')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('editor-school-work-hours-part_time'));
    await fireEvent.press(screen.getByTestId('editor-school-work-hours-full_time'));
    await fireEvent.press(screen.getByTestId('editor-school-work-hours-weekends'));
    await fireEvent.press(screen.getByTestId('editor-school-work-save'));
    expect(state.setAbout).toHaveBeenCalledWith(
      expect.objectContaining({ workType: 'food_service', jobTitle: 'barista', workHours: ['full_time', 'weekends'] })
    );
  });

  it('not working right now clears and hides the hours', async () => {
    const { state, screen: pending } = renderEditor({ ...EMPTY_ABOUT, workType: 'retail', workHours: ['nights'] });
    const screen = await pending;
    await fireEvent.press(screen.getByTestId('editor-school-work-type-not_working_right_now'));
    expect(screen.queryByTestId('editor-school-work-hours-nights')).toBeNull();
    await fireEvent.press(screen.getByTestId('editor-school-work-save'));
    expect(state.setAbout).toHaveBeenCalledWith(expect.objectContaining({ workType: 'not_working_right_now', workHours: [] }));
  });

  it('a filtered job title shows the neutral line on the title field, with the text kept', async () => {
    const { screen: pending } = renderEditor(
      { ...EMPTY_ABOUT, jobTitle: 'some text' },
      { fieldErrors: { about: "that text can't be used." } }
    );
    const screen = await pending;
    expect(screen.getByTestId('editor-school-work-title-input').props.value).toBe('some text');
    expect(screen.getByText("that text can't be used.")).toBeTruthy();
  });
});

describe('/profile-editor/tags', () => {
  it('writes the picks into the draft (not the server) on done', async () => {
    const state = draftState(EMPTY_ABOUT);
    (useProfileEditorDraftContext as jest.Mock).mockReturnValue(state);
    const screen = await render(<EditTagsScreen />);
    expect(screen.getByTestId('editor-tags-picker-submit')).toHaveTextContent('done · 1 of 10');
    await fireEvent.press(screen.getByTestId('editor-tags-picker-chip-t3'));
    await fireEvent.press(screen.getByTestId('editor-tags-picker-submit'));
    expect(state.setTagIds).toHaveBeenCalledWith(['t1', 't3']);
    expect(setMyTags).not.toHaveBeenCalled();
  });
});

describe('the one-time tags notice', () => {
  const NOTICE = { id: 'n1', kind: 'tags_changed' as const, dropped: ['gym', 'library'], major: 'nursing' };

  it('says what did not carry over and where the major went', () => {
    expect(tagsChangedCopy(NOTICE)).toBe(
      "we've reorganised tags. a few of yours didn't carry over: gym, library. your major, nursing, moved to the about part of your profile. pick up to ten interests."
    );
    expect(tagsChangedCopy({ dropped: [], major: null })).toBe("we've reorganised tags. they're interests now. pick up to ten interests.");
  });

  it('pick interests dismisses it and opens the picker', async () => {
    (listUnseenNotices as jest.Mock).mockResolvedValue([NOTICE]);
    (dismissNotice as jest.Mock).mockResolvedValue(true);
    const screen = await withClient(<TagsChangedNotice />);
    expect(await screen.findByTestId('tags-notice-body')).toHaveTextContent(/gym, library/);
    await fireEvent.press(screen.getByTestId('tags-notice-pick'));
    expect(dismissNotice).toHaveBeenCalledWith('n1');
    expect(router.push).toHaveBeenCalledWith('/interests');
    expect(screen.queryByTestId('tags-notice')).toBeNull();
  });

  it('not now dismisses it too, so it shows once', async () => {
    (listUnseenNotices as jest.Mock).mockResolvedValue([NOTICE]);
    (dismissNotice as jest.Mock).mockRejectedValue(new Error('offline'));
    const screen = await withClient(<TagsChangedNotice />);
    await fireEvent.press(await screen.findByTestId('tags-notice-later'));
    expect(dismissNotice).toHaveBeenCalledWith('n1');
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.queryByTestId('tags-notice')).toBeNull();
  });

  it('shows nothing (and blocks nothing) with no notice or a failed read', async () => {
    (listUnseenNotices as jest.Mock).mockRejectedValue(new Error('offline'));
    const screen = await withClient(<TagsChangedNotice />);
    await waitFor(() => expect(listUnseenNotices).toHaveBeenCalled());
    expect(screen.queryByTestId('tags-notice')).toBeNull();
  });
});
