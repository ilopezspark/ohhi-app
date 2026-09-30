import { fireEvent, render } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({})),
}));
jest.mock('../me/editor/useProfileEditorDraft', () => ({ useProfileEditorDraft: jest.fn() }));
jest.mock('../me/editor/useMyPhotos', () => ({ useMyPhotos: jest.fn() }));

import { router, useLocalSearchParams } from 'expo-router';
import { useProfileEditorDraft } from '../me/editor/useProfileEditorDraft';
import { useMyPhotos } from '../me/editor/useMyPhotos';
import { previewSourceOf, setPreviewDraft } from '../me/editor/previewDraft';
import ProfilePreviewScreen from '../app/profile-preview';
import { buildPreviewData } from '../me/editor/previewData';
import { usePresenceStore } from '../presence/store';
import { EMPTY_ABOUT, type AboutSection } from '../profile/about';

const thisYear = new Date().getFullYear();

const BASE_DRAFT_STATE = {
  loading: false,
  ready: true,
  loadError: null,
  retry: jest.fn(),
  userId: 'u1',
  firstName: 'izaac',
  gradYear: 2027,
  campusShort: 'CLC',
  verified: true,
  photoCount: 1,
  catalog: [
    { id: 't1', label: 'coffee', category: 'food_drink', categoryLabel: 'food & drink', categoryOrder: 8, sortOrder: 4 },
    { id: 't2', label: 'gym', category: 'fitness', categoryLabel: 'fitness', categoryOrder: 2, sortOrder: 1 },
    { id: 't3', label: 'anime', category: 'film_tv', categoryLabel: 'film & tv', categoryOrder: 4, sortOrder: 6 },
  ],
  draft: {
    statusLine: 'at the library',
    goals: ['friends'],
    tagIds: ['t1'],
    placeLine: '',
    usualPlaces: [] as string[],
    prompts: [] as { promptId: string; question: string; gated: boolean; answer: string }[],
    about: { ...EMPTY_ABOUT, major: { id: 'p-nursing', label: 'nursing' }, graduatingTerm: 'spring', graduatingYear: 2027 } as AboutSection,
  },
  fieldsMeta: {
    savedPlaceLine: null as string | null,
    placeLineUntil: null as string | null,
    placeLineShown: false,
    joinedMonth: `${thisYear}-09-01`,
    joinedRecency: null,
  },
  setStatusLine: jest.fn(),
  setGoals: jest.fn(),
  setTagIds: jest.fn(),
  dirty: false,
  saving: false,
  saveError: null,
  commit: jest.fn(),
  discard: jest.fn(),
  completion: { percent: 50, items: [], nextBest: null },
};

function withDraft(draft: Partial<typeof BASE_DRAFT_STATE.draft>, fieldsMeta: Partial<typeof BASE_DRAFT_STATE.fieldsMeta> = {}) {
  (useProfileEditorDraft as jest.Mock).mockReturnValue({
    ...BASE_DRAFT_STATE,
    draft: { ...BASE_DRAFT_STATE.draft, ...draft },
    fieldsMeta: { ...BASE_DRAFT_STATE.fieldsMeta, ...fieldsMeta },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (useLocalSearchParams as jest.Mock).mockReturnValue({});
  setPreviewDraft(null);
  (useProfileEditorDraft as jest.Mock).mockReturnValue(BASE_DRAFT_STATE);
  (useMyPhotos as jest.Mock).mockReturnValue({
    photos: [{ storage_path: 'u1/a.jpg' }, { storage_path: 'u1/b.jpg' }],
    urls: {},
    isLoading: false,
    refetch: jest.fn(),
    invalidate: jest.fn(),
  });
  usePresenceStore.setState({ tier: 'on_campus', hereNow: false, permission: 'granted', paused: false });
});

/**
 * Preview and the real profile are one component: `/profile-preview` renders the
 * same full-screen `ProfileView` as `profile/[id].tsx`, in `preview` mode, fed
 * from the saved profile (`useProfileEditorDraft`, which reads
 * `my_profile_fields()`) or the editor's draft. Nothing here is mocked below
 * the draft hook, so every assertion is against the real view.
 */
describe('ProfilePreviewScreen', () => {
  it('renders the full ProfileView (hero, details, footer)', async () => {
    const { findByTestId } = await render(<ProfilePreviewScreen />);
    await findByTestId('profile-preview-view');
    expect(await findByTestId('profile-preview-name')).toHaveTextContent('izaac');
    await findByTestId('profile-preview-details');
    await findByTestId('profile-preview-photo-card-1');
    expect(await findByTestId('profile-preview-footer-verified')).toHaveTextContent(
      'verified student at CLC · on ohhi since september'
    );
  });

  it('greys out the say-hi/message bar and hides report/block', async () => {
    const screen = await render(<ProfilePreviewScreen />);
    const bar = screen.getByTestId('profile-preview-action-bar', { includeHiddenElements: true });
    expect(bar.props.pointerEvents).toBe('none');
    expect(bar.props.accessibilityElementsHidden).toBe(true);
    screen.getByTestId('profile-preview-cta-hi', { includeHiddenElements: true });
    screen.getByTestId('profile-preview-cta-message', { includeHiddenElements: true });
    expect(screen.queryByTestId('profile-preview-report-block')).toBeNull();
    expect(screen.queryByTestId('profile-preview-overflow-trigger')).toBeNull();
  });

  it('reflects the DRAFT status line, goals and tags', async () => {
    withDraft({ statusLine: 'a brand new unsaved status', goals: ['study'], tagIds: ['t2', 't3'] });
    const screen = await render(<ProfilePreviewScreen />);
    expect(screen.getByTestId('profile-preview-status-line')).toHaveTextContent('a brand new unsaved status');
    expect(screen.getByTestId('profile-preview-goals')).toHaveTextContent('here for study');
    expect(screen.getByTestId('profile-preview-tags')).toHaveTextContent('here for studygymanime'); // every tag is an interest chip, in picked order
    // the major comes from the draft about section and goes to the pin line
    expect(screen.getByTestId('profile-preview-meta')).toHaveTextContent("on campus · nursing '27");
  });

  it('shows the draft about section as the about card, through the shared ProfileView', async () => {
    withDraft({
      about: {
        ...EMPTY_ABOUT,
        major: { id: 'p-cs', label: 'cs' },
        graduatingUnsure: true,
        workType: 'retail',
        jobTitle: 'cashier',
        workHours: ['weekends'],
      },
    });
    const screen = await render(<ProfilePreviewScreen />);
    expect(screen.getByTestId('profile-preview-about-major')).toHaveTextContent('cs');
    expect(screen.getByTestId('profile-preview-about-graduating')).toHaveTextContent('not sure yet');
    expect(screen.getByTestId('profile-preview-about-work')).toHaveTextContent(/retail · cashier/);
    // not sure yet: no year on the pin line
    expect(screen.getByTestId('profile-preview-meta')).toHaveTextContent('on campus · cs');
    expect(screen.getByTestId('profile-preview-meta')).not.toHaveTextContent(/'2/);
  });

  it('shows draft prompts between the photos, with the gated note on a gated one', async () => {
    withDraft({
      prompts: [
        { promptId: 'find_me_on_campus', question: "you'll find me on campus at", gated: true, answer: 'second floor' },
        { promptId: 'cafe_order', question: 'my order at the campus cafe', gated: false, answer: 'oat latte' },
      ],
    });
    const screen = await render(<ProfilePreviewScreen />);
    expect(screen.getByTestId('profile-preview-prompt-0-note')).toHaveTextContent('only shown after a hi has been answered.');
    expect(screen.getByTestId('profile-preview-prompt-1-answer')).toHaveTextContent('oat latte');
    expect(screen.queryByTestId('profile-preview-prompt-1-note')).toBeNull();
  });

  it('shows the owner their own usual places, with the note', async () => {
    withDraft({ usualPlaces: ['library', 'the gym'] });
    const screen = await render(<ProfilePreviewScreen />);
    expect(screen.getByTestId('profile-preview-around-campus-places')).toHaveTextContent('library, the gym');
    expect(screen.getByTestId('profile-preview-around-campus-note')).toHaveTextContent('only shown after a hi has been answered.');
  });

  it('reads tier and here-now from the presence store', async () => {
    usePresenceStore.setState({ tier: 'nearby', hereNow: true });
    const screen = await render(<ProfilePreviewScreen />);
    screen.getByTestId('profile-preview-here-now-badge');
    expect(screen.getByTestId('profile-preview-tier-pill')).toHaveTextContent('nearby');
  });

  it('back is a plain router.back(), from the photo button', async () => {
    const screen = await render(<ProfilePreviewScreen />);
    await fireEvent.press(screen.getByTestId('profile-preview-back'));
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('has the real screen chrome: a back button and no edit controls or tab bar', async () => {
    const screen = await render(<ProfilePreviewScreen />);
    screen.getByTestId('profile-preview-back');
    expect(screen.queryByTestId('profile-editor-done')).toBeNull();
    expect(screen.queryByTestId('profile-editor-cancel')).toBeNull();
    expect(screen.queryByTestId('profile-editor-preview')).toBeNull();
  });

  it('shows the saved profile when opened from Me', async () => {
    (useProfileEditorDraft as jest.Mock).mockReturnValue({
      ...BASE_DRAFT_STATE,
      draft: { ...BASE_DRAFT_STATE.draft, statusLine: 'saved status' },
    });
    setPreviewDraft(previewSourceOf({ ...BASE_DRAFT_STATE, draft: { ...BASE_DRAFT_STATE.draft, statusLine: 'stale draft' } } as never));
    const screen = await render(<ProfilePreviewScreen />);
    expect(screen.getByTestId('profile-preview-status-line')).toHaveTextContent('saved status');
  });

  it('shows the editor draft, unsaved edits included, when opened from the editor', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ from: 'editor' });
    setPreviewDraft(previewSourceOf({ ...BASE_DRAFT_STATE, draft: { ...BASE_DRAFT_STATE.draft, statusLine: 'not saved yet' } } as never));
    const screen = await render(<ProfilePreviewScreen />);
    expect(screen.getByTestId('profile-preview-status-line')).toHaveTextContent('not saved yet');
  });

  it('shows a spinner with a back while the profile loads, and a retry when it fails', async () => {
    (useProfileEditorDraft as jest.Mock).mockReturnValue({ ...BASE_DRAFT_STATE, ready: false, loading: true });
    const loading = await render(<ProfilePreviewScreen />);
    loading.getByTestId('profile-preview-loading');
    await fireEvent.press(loading.getByLabelText('Back'));
    expect(router.back).toHaveBeenCalledTimes(1);
    loading.unmount();

    const retry = jest.fn();
    (useProfileEditorDraft as jest.Mock).mockReturnValue({ ...BASE_DRAFT_STATE, ready: false, loading: false, loadError: "that didn't load. try again.", retry });
    const failed = await render(<ProfilePreviewScreen />);
    await fireEvent.press(failed.getByTestId('profile-preview-retry'));
    expect(retry).toHaveBeenCalled();
  });
});

describe('buildPreviewData — the place line', () => {
  const input = {
    userId: 'u1',
    firstName: 'izaac',
    gradYear: 2027,
    verified: true,
    campusShort: 'CLC',
    catalog: [],
    photoPaths: [],
    photoUrls: {},
    tier: 'on_campus' as const,
    hereNow: false,
  };
  const draft = { ...BASE_DRAFT_STATE.draft, goals: [] };

  it('shows a saved line only while others see it', () => {
    const meta = { ...BASE_DRAFT_STATE.fieldsMeta, savedPlaceLine: 'library' };
    expect(buildPreviewData({ ...input, draft: { ...draft, placeLine: 'library' }, fieldsMeta: { ...meta, placeLineShown: true } }).placeLine).toBe(
      'library'
    );
    expect(buildPreviewData({ ...input, draft: { ...draft, placeLine: 'library' }, fieldsMeta: { ...meta, placeLineShown: false } }).placeLine).toBeNull();
  });

  it('shows an edited line (saving starts a fresh two hours)', () => {
    const meta = { ...BASE_DRAFT_STATE.fieldsMeta, savedPlaceLine: 'library', placeLineShown: false };
    expect(buildPreviewData({ ...input, draft: { ...draft, placeLine: 'gym' }, fieldsMeta: meta }).placeLine).toBe('gym');
  });

  it('never says what you two share, and drops blank answers', () => {
    const data = buildPreviewData({
      ...input,
      draft: { ...draft, prompts: [{ promptId: 'a', question: 'q', gated: false, answer: '  ' }] },
      fieldsMeta: null,
    });
    expect(data.sharedLines).toEqual([]);
    expect(data.prompts).toEqual([]);
    expect(data.joinedMonth).toBeNull();
  });
});
