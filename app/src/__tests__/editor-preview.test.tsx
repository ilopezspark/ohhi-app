import { render } from '@testing-library/react-native';

jest.mock('../me/editor/ProfileEditorDraftContext', () => ({
  useProfileEditorDraftContext: jest.fn(),
}));
jest.mock('../me/editor/useMyPhotos', () => ({ useMyPhotos: jest.fn() }));

import { useProfileEditorDraftContext } from '../me/editor/ProfileEditorDraftContext';
import { useMyPhotos } from '../me/editor/useMyPhotos';
import { PreviewCard } from '../me/editor/PreviewCard';
import { usePresenceStore } from '../presence/store';

const BASE_DRAFT_STATE = {
  loading: false,
  loadError: null,
  userId: 'u1',
  firstName: 'izaac',
  gradYear: 2027,
  campusShort: 'CLC',
  verified: true,
  photoCount: 1,
  campusTags: [
    { id: 't1', label: 'library', category: 'other', campus_id: null },
    { id: 't2', label: 'gym', category: 'other', campus_id: null },
  ],
  draft: { statusLine: 'at the library', goals: ['friends'], tagIds: ['t1'] },
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

beforeEach(() => {
  jest.clearAllMocks();
  (useProfileEditorDraftContext as jest.Mock).mockReturnValue(BASE_DRAFT_STATE);
  (useMyPhotos as jest.Mock).mockReturnValue({
    photos: [],
    urls: {},
    isLoading: false,
    refetch: jest.fn(),
    invalidate: jest.fn(),
  });
  usePresenceStore.setState({ tier: 'on_campus', hereNow: false, permission: 'granted', paused: false });
});

/**
 * `PreviewCard` must render through the exact same `ProfileTile` the grid
 * and `profile/[id].tsx` use — not a copy (`docs/design/me-redesign/
 * brief.md`'s own instruction). This suite doesn't mock `ProfileTile`
 * itself (only the editor's own data hooks), so every assertion below only
 * passes because the REAL `ProfileTile` hero variant is what's actually
 * rendering — its own distinctive testID scheme (`ui/ProfileTile.tsx`'s
 * `testIDs` prop) and its own `disabledActions` opacity/pointer-events
 * wiring, neither of which this file re-implements.
 */
describe('PreviewCard', () => {
  it('renders through the shared ProfileTile hero (the same testID scheme profile/[id].tsx uses)', async () => {
    const { findByTestId } = await render(<PreviewCard />);
    await findByTestId('profile-editor-preview-tile');
    const name = await findByTestId('profile-editor-preview-name');
    expect(name).toHaveTextContent('izaac');
  });

  it('disables the say-hi/message footer (accessibilityElementsHidden, matching ProfileTile\'s own disabledActions wiring)', async () => {
    const { root } = await render(<PreviewCard />);
    const hiddenFooters = root!.queryAll((i) => i.props.accessibilityElementsHidden === true);
    expect(hiddenFooters.length).toBeGreaterThan(0);
    const nonInteractive = root!.queryAll((i) => i.props.pointerEvents === 'none');
    expect(nonInteractive.length).toBeGreaterThan(0);
  });

  it('still renders the say-hi/message buttons underneath (just non-interactive, not absent)', async () => {
    // The footer is deliberately hidden from accessibility (the test above),
    // so RNTL's default queries skip it; opt in to hidden elements to prove
    // the buttons are still mounted and visible at 40% opacity.
    const { findByTestId } = await render(<PreviewCard />);
    await findByTestId('profile-editor-preview-cta-hi', { includeHiddenElements: true });
    await findByTestId('profile-editor-preview-cta-message', { includeHiddenElements: true });
  });

  it('reflects the DRAFT status line, not any separately-saved value', async () => {
    (useProfileEditorDraftContext as jest.Mock).mockReturnValue({
      ...BASE_DRAFT_STATE,
      draft: { ...BASE_DRAFT_STATE.draft, statusLine: 'a brand new unsaved status' },
    });
    const { findByTestId } = await render(<PreviewCard />);
    const status = await findByTestId('profile-editor-preview-status');
    expect(status.props.children).toBe('a brand new unsaved status');
  });

  it('reflects DRAFT goals and tags, mapped to their display labels', async () => {
    (useProfileEditorDraftContext as jest.Mock).mockReturnValue({
      ...BASE_DRAFT_STATE,
      draft: { statusLine: '', goals: ['study'], tagIds: ['t2'] },
    });
    const { findByText } = await render(<PreviewCard />);
    await findByText('here for study buddies');
    await findByText('gym');
  });

  it('reads tier and here-now from the presence store', async () => {
    usePresenceStore.setState({ tier: 'nearby', hereNow: true });
    const { findByTestId } = await render(<PreviewCard />);
    const hereNowBadge = await findByTestId('profile-editor-preview-here-now');
    expect(hereNowBadge).toBeTruthy();
  });

  it('shows the before/after captions', async () => {
    const { findByText } = await render(<PreviewCard />);
    await findByText('this is you on the grid right now.');
    await findByText("their buttons are greyed out. you can't say hi to yourself.");
  });
});
