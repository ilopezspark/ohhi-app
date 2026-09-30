import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: jest.fn(() => ({})),
  useNavigation: jest.fn(() => ({ dispatch: jest.fn() })),
}));
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }));
jest.mock('../me/editor/ProfileEditorDraftContext', () => ({ useProfileEditorDraftContext: jest.fn() }));
// The two tab bodies have their own suites (editor-preview, editor-draft);
// here they only need to show which tab is up.
jest.mock('../me/editor/EditSections', () => {
  const { View: RNView } = require('react-native');
  return { EditSections: () => <RNView testID="stub-edit-sections" /> };
});
jest.mock('../me/editor/PreviewCard', () => {
  const { View: RNView } = require('react-native');
  return { PreviewCard: () => <RNView testID="stub-preview-card" /> };
});
jest.mock('../api/client', () => ({ supabase: {} }));
jest.mock('../api/profile', () => ({ getStatusLine: jest.fn(), updateProfile: jest.fn() }));

import { router, useLocalSearchParams } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useProfileEditorDraftContext } from '../me/editor/ProfileEditorDraftContext';
import { getStatusLine, updateProfile } from '../api/profile';
import ProfileEditorScreen from '../app/profile-editor/index';
import EditStatusScreen from '../app/profile-editor/status';
import QuickStatusScreen from '../app/quick-status';
import { queryKeys } from '../me/queryKeys';
import { EMPTY_ABOUT } from '../profile/about';

function draftState(overrides: Record<string, unknown> = {}) {
  return {
    loading: false,
    ready: true,
    loadError: null,
    userId: 'u1',
    firstName: 'izaac',
    gradYear: 2027,
    campusShort: 'CLC',
    verified: true,
    photoCount: 1,
    catalog: [],
    fieldErrors: {},
    minTags: 0,
    draft: { statusLine: 'at the library', goals: ['friends'], tagIds: [], placeLine: '', usualPlaces: [], prompts: [], about: EMPTY_ABOUT },
    setStatusLine: jest.fn(),
    setGoals: jest.fn(),
    setTagIds: jest.fn(),
    dirty: false,
    saving: false,
    saveError: null,
    commit: jest.fn(() => Promise.resolve(true)),
    discard: jest.fn(),
    retry: jest.fn(),
    completion: { percent: 50, items: [], nextBest: null },
    ...overrides,
  };
}

function mockDraft(overrides: Record<string, unknown> = {}) {
  const state = draftState(overrides);
  (useProfileEditorDraftContext as jest.Mock).mockReturnValue(state);
  return state;
}

beforeEach(() => {
  jest.clearAllMocks();
  (useLocalSearchParams as jest.Mock).mockReturnValue({});
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('ProfileEditorScreen', () => {
  it('opens on edit by default, with the name in the header', async () => {
    mockDraft();
    const { findByTestId, getByText } = await render(<ProfileEditorScreen />);
    await findByTestId('stub-edit-sections');
    expect(getByText('izaac')).toBeTruthy();
  });

  it('?tab=preview opens straight onto preview', async () => {
    mockDraft();
    (useLocalSearchParams as jest.Mock).mockReturnValue({ tab: 'preview' });
    const { findByTestId, queryByTestId } = await render(<ProfileEditorScreen />);
    await findByTestId('stub-preview-card');
    expect(queryByTestId('stub-edit-sections')).toBeNull();
  });

  it('switches tabs', async () => {
    mockDraft();
    const { findByTestId } = await render(<ProfileEditorScreen />);
    await fireEvent.press(await findByTestId('profile-editor-tab-preview'));
    await findByTestId('stub-preview-card');
    await fireEvent.press(await findByTestId('profile-editor-tab-edit'));
    await findByTestId('stub-edit-sections');
  });

  it('cancel with nothing changed just closes', async () => {
    mockDraft();
    const { findByTestId } = await render(<ProfileEditorScreen />);
    await fireEvent.press(await findByTestId('profile-editor-cancel'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('cancel with unsaved edits asks first, and discard throws the draft away before closing', async () => {
    const state = mockDraft({ dirty: true });
    const { findByTestId } = await render(<ProfileEditorScreen />);
    await fireEvent.press(await findByTestId('profile-editor-cancel'));

    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(router.back).not.toHaveBeenCalled();
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as { text: string; onPress?: () => void }[];
    const discard = buttons.find((b) => b.text === 'discard');
    discard?.onPress?.();

    expect(state.discard).toHaveBeenCalled();
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('guards every other way out (swipe-down, hardware back) while the draft is dirty', async () => {
    mockDraft({ dirty: true });
    await render(<ProfileEditorScreen />);
    const calls = (usePreventRemove as jest.Mock).mock.calls;
    expect(calls[calls.length - 1][0]).toBe(true);
  });

  it('does not guard a clean draft', async () => {
    mockDraft({ dirty: false });
    await render(<ProfileEditorScreen />);
    const calls = (usePreventRemove as jest.Mock).mock.calls;
    expect(calls[calls.length - 1][0]).toBe(false);
  });

  it('done commits and closes on success', async () => {
    const state = mockDraft({ dirty: true });
    const { findByTestId } = await render(<ProfileEditorScreen />);
    await fireEvent.press(await findByTestId('profile-editor-done'));
    expect(state.commit).toHaveBeenCalled();
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('done stays open and shows the error when a save fails', async () => {
    mockDraft({ dirty: true, commit: jest.fn(() => Promise.resolve(false)), saveError: "that didn't work." });
    const { findByTestId } = await render(<ProfileEditorScreen />);
    await fireEvent.press(await findByTestId('profile-editor-done'));
    await findByTestId('profile-editor-done-error');
    expect(router.back).not.toHaveBeenCalled();
  });

  it('a failed first load shows the error and a retry, not an endless spinner', async () => {
    const state = mockDraft({ loading: false, ready: false, loadError: "that didn't load. try again." });
    const { findByTestId, queryByTestId } = await render(<ProfileEditorScreen />);
    await findByTestId('profile-editor-load-error');
    expect(queryByTestId('stub-edit-sections')).toBeNull();
    await fireEvent.press(await findByTestId('profile-editor-retry'));
    expect(state.retry).toHaveBeenCalled();
  });
});

describe('EditStatusScreen (profile editor)', () => {
  it('writes the trimmed value into the draft (not the server) and pops back', async () => {
    const state = mockDraft({ draft: { statusLine: 'old', goals: [], tagIds: [], placeLine: '', usualPlaces: [], prompts: [], about: EMPTY_ABOUT } });
    const { findByTestId } = await render(<EditStatusScreen />);
    await fireEvent.changeText(await findByTestId('editor-status-editor-input'), '  gym at 6  ');
    await fireEvent.press(await findByTestId('editor-status-editor-save'));
    expect(state.setStatusLine).toHaveBeenCalledWith('gym at 6');
    expect(updateProfile).not.toHaveBeenCalled();
    expect(router.back).toHaveBeenCalled();
  });

  it('cancel leaves the draft alone', async () => {
    const state = mockDraft();
    const { findByTestId } = await render(<EditStatusScreen />);
    await fireEvent.press(await findByTestId('editor-status-editor-cancel'));
    expect(state.setStatusLine).not.toHaveBeenCalled();
    expect(router.back).toHaveBeenCalled();
  });
});

describe('QuickStatusScreen', () => {
  function renderQuick() {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
    });
    const utils = render(
      <QueryClientProvider client={client}>
        <QuickStatusScreen />
      </QueryClientProvider>
    );
    return { client, utils };
  }

  it('saves straight to the server and closes', async () => {
    // First read, then the refetch the save's invalidation triggers.
    (getStatusLine as jest.Mock).mockResolvedValueOnce('old status').mockResolvedValue('free between classes');
    (updateProfile as jest.Mock).mockResolvedValue(undefined);
    const { client, utils } = renderQuick();
    const { findByTestId } = await utils;

    const input = await findByTestId('quick-status-editor-input');
    expect(input.props.value).toBe('old status');
    await fireEvent.changeText(input, 'free between classes');
    await fireEvent.press(await findByTestId('quick-status-editor-save'));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ status_line: 'free between classes' }));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(client.getQueryData(queryKeys.me.status)).toBe('free between classes');
  });

  it('clearing the field saves null, not an empty string', async () => {
    (getStatusLine as jest.Mock).mockResolvedValue('old status');
    (updateProfile as jest.Mock).mockResolvedValue(undefined);
    const { utils } = renderQuick();
    const { findByTestId } = await utils;
    await fireEvent.press(await findByTestId('quick-status-editor-clear'));
    await fireEvent.press(await findByTestId('quick-status-editor-save'));
    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ status_line: null }));
  });

  it('rolls back and stays open when the save fails', async () => {
    (getStatusLine as jest.Mock).mockResolvedValue('old status');
    (updateProfile as jest.Mock).mockRejectedValue(new Error('offline'));
    const { client, utils } = renderQuick();
    const { findByTestId } = await utils;
    await fireEvent.changeText(await findByTestId('quick-status-editor-input'), 'new');
    await fireEvent.press(await findByTestId('quick-status-editor-save'));

    await findByTestId('quick-status-editor-error');
    expect(router.back).not.toHaveBeenCalled();
    expect(client.getQueryData(queryKeys.me.status)).toBe('old status');
  });
});
