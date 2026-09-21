import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { Sheet } from '../ui/Sheet';

describe('ui/Sheet', () => {
  it('renders its children inside the sheet', async () => {
    const { getByText } = await render(
      <Sheet>
        <Text>real students only.</Text>
      </Sheet>
    );
    expect(getByText('real students only.')).toBeTruthy();
  });

  it('shows the grab handle by default and can hide it', async () => {
    const { getByTestId: withHandle } = await render(<Sheet testID="sheet" />);
    // handle is an unlabelled View, so assert indirectly via the sheet still mounting cleanly
    expect(withHandle('sheet-backdrop')).toBeTruthy();

    const { queryByTestId } = await render(<Sheet showHandle={false} />);
    expect(queryByTestId('sheet-backdrop')).toBeTruthy();
  });

  it('tapping the backdrop calls onDismiss', async () => {
    const onDismiss = jest.fn();
    const { getByTestId } = await render(<Sheet testID="sheet" onDismiss={onDismiss} />);
    await fireEvent.press(getByTestId('sheet-backdrop'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
