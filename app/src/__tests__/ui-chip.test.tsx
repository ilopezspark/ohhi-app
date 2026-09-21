import { fireEvent, render } from '@testing-library/react-native';
import { Chip } from '../ui/Chip';
import { colors } from '../theme/tokens';

describe('ui/Chip', () => {
  it('renders as a non-interactive View when there is no onPress', async () => {
    const { getByTestId, queryByRole } = await render(<Chip testID="c" label="nursing" />);
    expect(getByTestId('c')).toBeTruthy();
    expect(queryByRole('checkbox')).toBeNull();
  });

  it('is pressable and reports selected state via accessibilityState when onPress is given', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(<Chip testID="c" label="'27" selected onPress={onPress} />);
    expect(getByTestId('c').props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
    await fireEvent.press(getByTestId('c'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('selected renders the ink fill regardless of tone', async () => {
    const { getByTestId } = await render(<Chip testID="c" label="'27" selected onPress={() => {}} />);
    const flat = [getByTestId('c').props.style].flat().filter(Boolean);
    expect(flat).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: colors.ink })]));
  });

  it('tint tone uses the flat tint fill with no shadow', async () => {
    const { getByTestId } = await render(<Chip testID="c" label="she/her" tone="tint" />);
    const flat = [getByTestId('c').props.style].flat().filter(Boolean);
    expect(flat).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: colors.tint })]));
  });

  it('surface tone (default) uses the white fill', async () => {
    const { getByTestId } = await render(<Chip testID="c" label="library" />);
    const flat = [getByTestId('c').props.style].flat().filter(Boolean);
    expect(flat).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: colors.surface })]));
  });

  it('sm size uses the tighter padding', async () => {
    const { getByTestId } = await render(<Chip testID="c" label="on prep" tone="tint" size="sm" />);
    const flat = [getByTestId('c').props.style].flat().filter(Boolean);
    expect(flat).toEqual(expect.arrayContaining([expect.objectContaining({ paddingVertical: 6, paddingHorizontal: 10 })]));
  });

  it('disabled chips do not fire onPress', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(<Chip testID="c" label="x" onPress={onPress} disabled />);
    await fireEvent.press(getByTestId('c'));
    expect(onPress).not.toHaveBeenCalled();
  });
});
