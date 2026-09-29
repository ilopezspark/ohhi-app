import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
jest.mock('../api/client', () => ({ supabase: {} }));
jest.mock('../api/profile', () => ({ getStatusLine: jest.fn(), updateProfile: jest.fn() }));
jest.mock('../api/profileFields', () => ({ getMyProfileFields: jest.fn(), setMyPlaceLine: jest.fn() }));

import { router } from 'expo-router';
import { getStatusLine, updateProfile } from '../api/profile';
import { getMyProfileFields, setMyPlaceLine } from '../api/profileFields';
import { InvalidInputError } from '../api/errors';
import QuickStatusScreen from '../app/quick-status';

function fields(overrides: Record<string, unknown> = {}) {
  return {
    placeLine: 'library',
    placeLineUntil: '2000-01-01T00:00:00Z',
    placeLineShown: false,
    usualPlaces: [],
    prompts: [],
    joinedMonth: null,
    joinedRecency: null,
    ...overrides,
  };
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <QuickStatusScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (getStatusLine as jest.Mock).mockResolvedValue('at the library');
  (updateProfile as jest.Mock).mockResolvedValue(undefined);
  (getMyProfileFields as jest.Mock).mockResolvedValue(fields());
  (setMyPlaceLine as jest.Mock).mockResolvedValue('2026-09-29T20:00:00Z');
});

describe('QuickStatus — the place line next to the status', () => {
  it('offers the saved place line under the status, and says why it is not showing', async () => {
    const screen = await renderScreen();
    const input = await screen.findByTestId('quick-status-place-input');
    expect(input.props.value).toBe('library');
    expect(input.props.maxLength).toBe(40);
    expect(screen.getByTestId('quick-status-place-status')).toHaveTextContent(/not showing right now/);
  });

  it('a status-only save leaves the place line alone (saving it would restart its two hours)', async () => {
    const screen = await renderScreen();
    await screen.findByTestId('quick-status-place-input');
    await fireEvent.changeText(screen.getByTestId('quick-status-editor-input'), 'free till 3');
    await fireEvent.press(screen.getByTestId('quick-status-editor-save'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(updateProfile).toHaveBeenCalledWith({ status_line: 'free till 3' });
    expect(setMyPlaceLine).not.toHaveBeenCalled();
  });

  it('saves an edited place line (trimmed) together with the status', async () => {
    const screen = await renderScreen();
    await fireEvent.changeText(await screen.findByTestId('quick-status-place-input'), ' student union ');
    await fireEvent.press(screen.getByTestId('quick-status-editor-save'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(setMyPlaceLine).toHaveBeenCalledWith('student union');
  });

  it('re-saving the same line refreshes it; clearing sends null', async () => {
    const screen = await renderScreen();
    const input = await screen.findByTestId('quick-status-place-input');
    await fireEvent.changeText(input, 'library');
    await fireEvent.press(screen.getByTestId('quick-status-editor-save'));
    await waitFor(() => expect(setMyPlaceLine).toHaveBeenCalledWith('library'));

    (router.back as jest.Mock).mockClear();
    const again = await renderScreen();
    await fireEvent.press(await again.findByTestId('quick-status-place-clear'));
    await fireEvent.press(again.getByTestId('quick-status-editor-save'));
    await waitFor(() => expect(setMyPlaceLine).toHaveBeenLastCalledWith(null));
  });

  it('a refused place line shows the mapped reason and stays open', async () => {
    (setMyPlaceLine as jest.Mock).mockRejectedValue(new InvalidInputError('keep it to 40 characters.'));
    const screen = await renderScreen();
    await fireEvent.changeText(await screen.findByTestId('quick-status-place-input'), 'somewhere');
    await fireEvent.press(screen.getByTestId('quick-status-editor-save'));
    expect(await screen.findByTestId('quick-status-editor-error')).toHaveTextContent('keep it to 40 characters.');
    expect(router.back).not.toHaveBeenCalled();
  });

  it('without my_profile_fields the place field is simply not offered, and status still saves', async () => {
    (getMyProfileFields as jest.Mock).mockRejectedValue(new Error('down'));
    const screen = await renderScreen();
    await screen.findByTestId('quick-status-editor-input');
    await waitFor(() => expect(getMyProfileFields).toHaveBeenCalled());
    expect(screen.queryByTestId('quick-status-place-input')).toBeNull();
    await fireEvent.press(screen.getByTestId('quick-status-editor-save'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });
});
