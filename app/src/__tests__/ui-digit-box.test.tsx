import { createRef } from 'react';
import { StyleSheet, TextInput } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { DigitBox } from '../ui/DigitBox';
import { colors, radii } from '../theme/tokens';

describe('ui/DigitBox', () => {
  it('puts the radius, fill and shadow on a wrapper and keeps the TextInput flat (Android draws a square elevation on a TextInput)', async () => {
    for (const value of ['', '7']) {
      const { getByTestId } = await render(<DigitBox testID="box" height={60} fontSize={26} value={value} />);
      const field = StyleSheet.flatten(getByTestId('box').props.style);
      expect(field.elevation).toBeUndefined();
      expect(field.shadowOpacity).toBeUndefined();
      expect(field.borderWidth).toBe(0);
      expect(field.backgroundColor).toBe('transparent');
      expect(field).toMatchObject({ fontSize: 26, textAlign: 'center', color: colors.ink });

      const wrapper = StyleSheet.flatten(getByTestId('box').parent?.props.style);
      expect(wrapper).toMatchObject({ height: 60, borderRadius: radii.lg, backgroundColor: colors.surface, elevation: 2 });
    }
  });

  it('passes props and the ref through to the TextInput', async () => {
    const onChangeText = jest.fn();
    const ref = createRef<TextInput>();
    const { getByTestId } = await render(
      <DigitBox ref={ref} testID="box" accessibilityLabel="digit" height={52} fontSize={20} maxLength={1} onChangeText={onChangeText} />
    );
    expect(getByTestId('box').props.accessibilityLabel).toBe('digit');
    expect(getByTestId('box').props.maxLength).toBe(1);
    await fireEvent.changeText(getByTestId('box'), '3');
    expect(onChangeText).toHaveBeenCalledWith('3');
    expect(ref.current).not.toBeNull();
  });

  it('takes layout (flex) for the wrapper through containerStyle', async () => {
    const { getByTestId } = await render(<DigitBox testID="box" height={60} fontSize={26} containerStyle={{ flex: 2 }} />);
    expect(StyleSheet.flatten(getByTestId('box').parent?.props.style).flex).toBe(2);
  });
});
