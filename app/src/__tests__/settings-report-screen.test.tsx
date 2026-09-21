import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  router: { back: (...a: unknown[]) => mockBack(...a) },
  useLocalSearchParams: () => ({ id: 'target-1', context: 'chat', conversationId: 'conv-1' }),
}));

// api/reports.ts imports the real supabase client (via ./client), which
// throws outside a real Expo config-eval context (no Constants.expoConfig
// under Jest) -- mock it out so requireActual below doesn't touch it.
jest.mock('../api/client', () => ({ supabase: {} }));
jest.mock('../api/me', () => ({ me: jest.fn() }));
jest.mock('../api/reports', () => {
  const actual = jest.requireActual('../api/reports');
  return { ...actual, submitReport: jest.fn() };
});

import { me } from '../api/me';
import { submitReport } from '../api/reports';
import ReportScreen from '../app/settings/report/[id]';

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ReportScreen />
    </QueryClientProvider>
  );
}

describe('ReportScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (me as jest.Mock).mockResolvedValue({ id: 'me-1', status: 'active' });
    (submitReport as jest.Mock).mockResolvedValue(undefined);
  });

  it('hides the entry point entirely for a non-active caller (decision 47), never attempting the insert', async () => {
    (me as jest.Mock).mockResolvedValue({ id: 'me-1', status: 'paused' });
    const { getByTestId, queryByTestId } = await renderScreen();

    await waitFor(() => expect(getByTestId('report-hidden')).toBeTruthy());
    expect(queryByTestId('report-category-list')).toBeNull();
  });

  it('renders no severity control anywhere in the DOM', async () => {
    const { getByTestId, queryByText } = await renderScreen();
    await waitFor(() => expect(getByTestId('report-screen')).toBeTruthy());

    expect(queryByText(/severity/i)).toBeNull();
    expect(queryByText(/\bp0\b/i)).toBeNull();
    expect(queryByText(/\bp1\b/i)).toBeNull();
    expect(queryByText(/\bp2\b/i)).toBeNull();
  });

  it('keeps submit disabled until a category is picked', async () => {
    const { getByTestId } = await renderScreen();
    await waitFor(() => expect(getByTestId('report-screen')).toBeTruthy());

    expect(getByTestId('report-submit').props.accessibilityState?.disabled).toBe(true);

    await fireEvent.press(getByTestId('report-category-harassment'));
    await waitFor(() => expect(getByTestId('report-submit').props.accessibilityState?.disabled).toBe(false));
  });

  it('submits with context_type/context_id from the route params', async () => {
    const { getByTestId } = await renderScreen();
    await waitFor(() => expect(getByTestId('report-screen')).toBeTruthy());

    await fireEvent.press(getByTestId('report-category-spam'));
    await fireEvent.press(getByTestId('report-submit'));

    await waitFor(() =>
      expect(submitReport).toHaveBeenCalledWith({
        subjectId: 'target-1',
        category: 'spam',
        note: null,
        contextType: 'chat',
        contextId: 'conv-1',
      })
    );
  });

  it('shows the generic thanks copy on success, regardless of category', async () => {
    const { getByTestId } = await renderScreen();
    await waitFor(() => expect(getByTestId('report-screen')).toBeTruthy());

    await fireEvent.press(getByTestId('report-category-other'));
    await fireEvent.press(getByTestId('report-submit'));

    await waitFor(() => expect(getByTestId('report-thanks')).toBeTruthy());
  });
});
