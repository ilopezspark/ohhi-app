import { fireEvent, render } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import { ListRow } from '../ui/ListRow';

describe('ui/ListRow', () => {
  it('renders a title and helper text', async () => {
    const { getByText } = await render(<ListRow title="albums" helper="3 · private" />);
    expect(getByText('albums')).toBeTruthy();
    expect(getByText('3 · private')).toBeTruthy();
  });

  it('renders as a plain View when there is no onPress', async () => {
    const { getByTestId, queryByRole } = await render(<ListRow testID="row" title="blocked" helper="2" />);
    expect(getByTestId('row')).toBeTruthy();
    expect(queryByRole('button')).toBeNull();
  });

  it('is pressable and fires onPress when given one', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(<ListRow testID="row" title="pause my grid" onPress={onPress} />);
    await fireEvent.press(getByTestId('row'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('a right node overrides helper', async () => {
    const { queryByText, getByTestId } = await render(
      <ListRow
        title="verification"
        helper="should not show"
        right={<View testID="right-slot"><Text>verified</Text></View>}
      />
    );
    expect(queryByText('should not show')).toBeNull();
    expect(getByTestId('right-slot')).toBeTruthy();
  });

  it('non-last rows carry the bottom hairline; last omits it', async () => {
    const { getByTestId: notLast } = await render(<ListRow testID="row" title="x" />);
    const flatNotLast = [notLast('row').props.style].flat().filter(Boolean);
    expect(flatNotLast.some((s) => s && typeof s === 'object' && 'borderBottomWidth' in s)).toBe(true);

    const { getByTestId: isLast } = await render(<ListRow testID="row" title="x" last />);
    const flatLast = [isLast('row').props.style].flat().filter(Boolean);
    expect(flatLast.some((s) => s && typeof s === 'object' && 'borderBottomWidth' in s)).toBe(false);
  });
});
