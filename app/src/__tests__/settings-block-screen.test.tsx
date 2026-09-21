import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), back: (...a: unknown[]) => mockBack(...a), replace: (...a: unknown[]) => mockReplace(...a) },
  useLocalSearchParams: () => ({ id: 'target-1', context: 'profile' }),
}));

jest.mock('../api/blocks', () => ({
  blockUser: jest.fn(),
}));

const mockMaybeSingle = jest.fn().mockResolvedValue({ data: { first_name: 'Alex' } });
jest.mock('../api/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mockMaybeSingle }),
      }),
    }),
  },
}));

import { blockUser } from '../api/blocks';
import BlockScreen from '../app/settings/block/[id]';

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BlockScreen />
    </QueryClientProvider>
  );
}

describe('BlockScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMaybeSingle.mockResolvedValue({ data: { first_name: 'Alex' } });
    (blockUser as jest.Mock).mockResolvedValue(undefined);
  });

  it('renders the confirmation before any API call fires', async () => {
    const { getByTestId } = await render(
      <QueryClientProvider client={new QueryClient()}>
        <BlockScreen />
      </QueryClientProvider>
    );

    expect(getByTestId('block-confirm')).toBeTruthy();
    expect(blockUser).not.toHaveBeenCalled();
  });

  it('shows the target’s name once loaded, in the confirmation copy', async () => {
    const { getByTestId } = await renderScreen();
    await waitFor(() => expect(getByTestId('block-screen')).toBeTruthy());
    await waitFor(() => expect(mockMaybeSingle).toHaveBeenCalled());
  });

  it('calls blockUser with the target id only after the confirm tap', async () => {
    const { getByTestId } = await renderScreen();

    expect(blockUser).not.toHaveBeenCalled();
    await fireEvent.press(getByTestId('block-confirm'));

    await waitFor(() => expect(blockUser).toHaveBeenCalledWith('target-1'));
  });

  it('navigates away (not back to the blocked thread/profile) once the block resolves', async () => {
    const { getByTestId } = await renderScreen();

    await fireEvent.press(getByTestId('block-confirm'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)/settings'));
  });

  it('shows a generic error and does not navigate when the block insert fails', async () => {
    (blockUser as jest.Mock).mockRejectedValue(new Error("That didn't work."));
    const { getByTestId } = await renderScreen();

    await fireEvent.press(getByTestId('block-confirm'));

    await waitFor(() => expect(getByTestId('block-error')).toBeTruthy());
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('cancel navigates back without calling blockUser', async () => {
    const { getByTestId } = await renderScreen();

    await fireEvent.press(getByTestId('block-cancel'));

    expect(blockUser).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalled();
  });
});
