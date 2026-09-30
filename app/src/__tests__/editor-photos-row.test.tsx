import { fireEvent, render } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
  useNavigation: () => ({ dispatch: jest.fn() }),
}));
jest.mock('../api/client', () => ({ supabase: {} }));
jest.mock('../me/editor/ProfileEditorDraftContext', () => ({ useProfileEditorDraftContext: jest.fn() }));
jest.mock('../me/editor/useMyPhotos', () => ({ useMyPhotos: jest.fn() }));
jest.mock('../me/card/summary', () => ({
  usePrivateCardSummary: () => ({ filled: 0, total: 9 }),
  useIdentityCardSummaries: () => null,
}));

import { router } from 'expo-router';
import { EditSections } from '../me/editor/EditSections';
import { useProfileEditorDraftContext } from '../me/editor/ProfileEditorDraftContext';
import { useMyPhotos } from '../me/editor/useMyPhotos';
import { gridSlotLabel, hasPhotoUnderReview, photoStateLabel, previewPhotos, PHOTO_STATE_COPY } from '../me/editor/photoStates';
import { EMPTY_ABOUT } from '../profile/about';

const USER = 'b6b6b6b6-1111-4b11-8b11-111111111111';

function row(id: string, position: number, moderation_state: 'ok' | 'pending' | 'removed' = 'ok') {
  return { id, user_id: USER, position, storage_path: `${USER}/${id}.jpg`, tint: '#E8C9B4', moderation_state, created_at: '2026-09-28T00:00:00Z' };
}

function mockPhotos(photos: ReturnType<typeof row>[], urls: Record<string, string> = {}) {
  const resignUrls = jest.fn();
  (useMyPhotos as jest.Mock).mockReturnValue({
    photos,
    urls,
    isLoading: false,
    isLoaded: true,
    refetch: jest.fn(),
    invalidate: jest.fn(),
    resignUrls,
  });
  return resignUrls;
}

beforeEach(() => {
  jest.clearAllMocks();
  (useProfileEditorDraftContext as jest.Mock).mockReturnValue({
    loading: false,
    ready: true,
    userId: 'u1',
    firstName: 'debbie',
    catalog: [],
    fieldErrors: {},
    minTags: 0,
    photoCount: 3,
    draft: { statusLine: '', goals: [], tagIds: [], placeLine: '', usualPlaces: [], prompts: [], about: EMPTY_ABOUT },
    fieldsMeta: null,
    completion: { percent: 50, items: [], nextBest: null },
  });
});

describe('photoStates', () => {
  it('names each state for the owner', () => {
    expect(photoStateLabel('ok')).toBeNull();
    expect(photoStateLabel('pending')).toBe('under review');
    expect(photoStateLabel('removed')).toBe('removed');
    expect(gridSlotLabel('ok')).toBe('on the grid');
    expect(gridSlotLabel('pending')).toBe('on the grid once approved');
    expect(hasPhotoUnderReview([row('a', 0), row('b', 1, 'pending')])).toBe(true);
    expect(hasPhotoUnderReview([row('a', 0), row('b', 1, 'removed')])).toBe(false);
  });

  it('the preview shows every pending photo, badged, and leaves a removed one out', () => {
    const { paths, badges } = previewPhotos([row('a', 0), row('b', 1, 'pending'), row('c', 2, 'removed')]);
    expect(paths).toEqual([`${USER}/a.jpg`, `${USER}/b.jpg`]);
    expect(badges).toEqual({ [`${USER}/b.jpg`]: 'under review' });
  });

  it('copy keeps the voice: lowercase, no exclamation points', () => {
    for (const value of Object.values(PHOTO_STATE_COPY)) {
      expect(value).toBe(value.toLowerCase());
      expect(value).not.toMatch(/!/);
    }
  });
});

describe('EditSections photos row', () => {
  it("Debbie's three photos (one ok, two pending) all show, the pending ones with their images and the pill", async () => {
    mockPhotos([row('a', 0), row('b', 1, 'pending'), row('c', 2, 'pending')], {
      [`${USER}/a.jpg`]: 'https://signed/a',
      [`${USER}/b.jpg`]: 'https://signed/b',
      [`${USER}/c.jpg`]: 'https://signed/c',
    });
    const screen = await render(<EditSections />);

    for (const i of [0, 1, 2]) expect(screen.getByTestId(`editor-photo-tile-${i}-image`)).toBeTruthy();
    expect(screen.queryByTestId('editor-photo-tile-0-under-review')).toBeNull();
    expect(screen.getByTestId('editor-photo-tile-1-under-review')).toHaveTextContent('under review');
    expect(screen.getByTestId('editor-photo-tile-2-under-review')).toHaveTextContent('under review');
    expect(screen.getByTestId('editor-photo-tile-0-grid-pill')).toHaveTextContent('on the grid');
    expect(screen.queryByTestId('editor-photo-add-badge')).toBeNull();
    expect(screen.getByTestId('editor-photo-review-hint')).toHaveTextContent(
      "under review means only you can see it until it's approved."
    );
  });

  it('a pending first photo goes on the grid once approved', async () => {
    mockPhotos([row('a', 0, 'pending')]);
    const screen = await render(<EditSections />);
    expect(screen.getByTestId('editor-photo-tile-0-grid-pill')).toHaveTextContent('on the grid once approved');
    // No URL yet: the slot still shows, the pill over a neutral tile.
    expect(screen.getByTestId('editor-photo-tile-0-placeholder')).toBeTruthy();
    expect(screen.getByTestId('editor-photo-tile-0-under-review')).toBeTruthy();
  });

  it('a removed photo is a neutral tile saying so, and tapping it opens the photos screen to replace it', async () => {
    mockPhotos([row('a', 0), row('b', 1, 'removed')], { [`${USER}/b.jpg`]: 'https://signed/b' });
    const screen = await render(<EditSections />);
    expect(screen.queryByTestId('editor-photo-tile-1-image')).toBeNull();
    expect(screen.getByTestId('editor-photo-tile-1-removed')).toHaveTextContent('removed');
    expect(screen.queryByTestId('editor-photo-review-hint')).toBeNull();
    await fireEvent.press(screen.getByTestId('editor-photo-tile-1'));
    expect(router.push).toHaveBeenCalledWith('/profile-editor/photos');
  });

  it('an image that fails to load (an expired signed URL) falls back to the tile and signs again', async () => {
    const resignUrls = mockPhotos([row('a', 0), row('b', 1, 'pending')], {
      [`${USER}/a.jpg`]: 'https://signed/a',
      [`${USER}/b.jpg`]: 'https://signed/b',
    });
    const screen = await render(<EditSections />);
    await fireEvent(screen.getByTestId('editor-photo-tile-1-image'), 'error');
    expect(screen.getByTestId('editor-photo-tile-1-placeholder')).toBeTruthy();
    expect(screen.getByTestId('editor-photo-tile-1-under-review')).toBeTruthy();
    expect(resignUrls).toHaveBeenCalled();
  });
});
