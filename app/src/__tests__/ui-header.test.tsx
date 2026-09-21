import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { BackButton, Header } from '../ui/Header';

describe('ui/BackButton', () => {
  it('fires onPress', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(<BackButton testID="back" onPress={onPress} />);
    await fireEvent.press(getByTestId('back'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('defaults accessibilityLabel to "Back"', async () => {
    const { getByTestId } = await render(<BackButton testID="back" onPress={() => {}} />);
    expect(getByTestId('back').props.accessibilityLabel).toBe('Back');
  });
});

describe('ui/Header', () => {
  it('renders the title', async () => {
    const { getByText } = await render(<Header title="settings" onBack={() => {}} />);
    expect(getByText('settings')).toBeTruthy();
  });

  it('omits the back button when there is no onBack', async () => {
    const { queryByLabelText } = await render(<Header title="grid" />);
    expect(queryByLabelText('Back')).toBeNull();
  });

  it('renders a trailing right slot and a center slot', async () => {
    const { getByTestId } = await render(
      <Header
        title="basics"
        onBack={() => {}}
        center={<Text testID="progress">progress</Text>}
        right={<Text testID="right">right</Text>}
      />
    );
    expect(getByTestId('progress')).toBeTruthy();
    expect(getByTestId('right')).toBeTruthy();
  });

  it('applies a custom titleSize', async () => {
    const { getByText } = await render(<Header title="quiet right now." titleSize={26} />);
    const flat = [getByText('quiet right now.').props.style].flat(Infinity).filter(Boolean);
    expect(flat).toEqual(expect.arrayContaining([expect.objectContaining({ fontSize: 26 })]));
  });
});
