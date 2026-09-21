import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { EmptyState } from '../ui/EmptyState';

describe('ui/EmptyState', () => {
  it('renders the title', async () => {
    const { getByText } = await render(<EmptyState title="quiet right now." />);
    expect(getByText('quiet right now.')).toBeTruthy();
  });

  it('renders an optional message', async () => {
    const { getByText, queryByText } = await render(<EmptyState title="quiet right now." message="check back after class." />);
    expect(getByText('check back after class.')).toBeTruthy();

    const { queryByText: queryNoMessage } = await render(<EmptyState title="quiet right now." />);
    expect(queryNoMessage('check back after class.')).toBeNull();
  });

  it('renders an optional icon and action', async () => {
    const { getByTestId } = await render(
      <EmptyState
        title="quiet right now."
        icon={<Text testID="icon">*</Text>}
        action={<Text testID="action">turn that on</Text>}
      />
    );
    expect(getByTestId('icon')).toBeTruthy();
    expect(getByTestId('action')).toBeTruthy();
  });
});
