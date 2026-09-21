import { fireEvent, render } from '@testing-library/react-native';
import { Toggle } from '../ui/Toggle';
import { colors } from '../theme/tokens';

describe('ui/Toggle', () => {
  it('reflects value via accessibilityState.checked', async () => {
    const { getByTestId, rerender } = await render(
      <Toggle testID="t" value={false} onValueChange={jest.fn()} />
    );
    expect(getByTestId('t').props.accessibilityState?.checked).toBe(false);

    await rerender(<Toggle testID="t" value onValueChange={jest.fn()} />);
    expect(getByTestId('t').props.accessibilityState?.checked).toBe(true);
  });

  it('calls onValueChange with the flipped value on press', async () => {
    const onValueChange = jest.fn();
    const { getByTestId } = await render(<Toggle testID="t" value={false} onValueChange={onValueChange} />);
    await fireEvent.press(getByTestId('t'));
    expect(onValueChange).toHaveBeenCalledWith(true);
  });

  it('is disabled and inert when disabled is set', async () => {
    const onValueChange = jest.fn();
    const { getByTestId } = await render(
      <Toggle testID="t" value={false} onValueChange={onValueChange} disabled />
    );
    const toggle = getByTestId('t');
    expect(toggle.props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(toggle);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('uses the dashed off-track and signal on-track colours', async () => {
    const { getByTestId, rerender } = await render(
      <Toggle testID="t" value={false} onValueChange={jest.fn()} />
    );
    const offFlat = [getByTestId('t').props.style].flat().filter(Boolean);
    expect(offFlat).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: colors.dashed })]));

    await rerender(<Toggle testID="t" value onValueChange={jest.fn()} />);
    const onFlat = [getByTestId('t').props.style].flat().filter(Boolean);
    expect(onFlat).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: colors.signal })]));
  });

  it('passes accessibilityLabel through', async () => {
    const { getByLabelText } = await render(
      <Toggle testID="t" value={false} onValueChange={jest.fn()} accessibilityLabel="show these on my profile" />
    );
    expect(getByLabelText('show these on my profile')).toBeTruthy();
  });
});
