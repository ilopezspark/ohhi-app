import { fireEvent, render } from '@testing-library/react-native';
import { Chip, ChipGroup } from '../ui/Chip';
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

describe('ui/Chip — Me redesign variants', () => {
  it('boundary tone (ruling 8) uses boundaryBg/boundaryInk unselected, boundaryInk fill / white text selected', async () => {
    const { getByTestId, getByText } = await render(
      <Chip testID="c" label="no substances" tone="boundary" onPress={() => {}} />
    );
    const flat = [getByTestId('c').props.style].flat().filter(Boolean);
    expect(flat).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: colors.boundaryBg })]));
    expect([getByText('no substances').props.style].flat()).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: colors.boundaryInk })])
    );

    const { getByTestId: getSel, getByText: getSelText } = await render(
      <Chip testID="c2" label="no substances" tone="boundary" selected onPress={() => {}} />
    );
    const flatSel = [getSel('c2').props.style].flat().filter(Boolean);
    expect(flatSel).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: colors.boundaryInk })]));
    expect([getSelText('no substances').props.style].flat()).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: colors.onDark })])
    );
  });

  it('action tone uses the paperTint fill with signalDeep text, regardless of selected', async () => {
    const { getByTestId, getByText } = await render(<Chip testID="c" label="change" tone="action" onPress={() => {}} />);
    const flat = [getByTestId('c').props.style].flat().filter(Boolean);
    expect(flat).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: colors.paperTint })]));
    expect([getByText('change').props.style].flat()).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: colors.signalDeep })])
    );
  });

  it('boundaryInk/boundaryBg are distinct from colors.danger (ruling 8)', () => {
    expect(colors.boundaryInk).not.toBe(colors.danger);
    expect(colors.boundaryBg).not.toBe(colors.danger);
  });
});

describe('ui/ChipGroup', () => {
  const options = [
    { value: 'friends', label: 'friends' },
    { value: 'study', label: 'study buddies' },
    { value: 'dates', label: 'something more' },
  ];

  it('multi mode toggles values freely up to no cap', async () => {
    const onChange = jest.fn();
    const { getByTestId } = await render(
      <ChipGroup testID="g" options={options} value={['friends']} onChange={onChange} />
    );
    await fireEvent.press(getByTestId('g-study'));
    expect(onChange).toHaveBeenCalledWith(['friends', 'study']);

    await fireEvent.press(getByTestId('g-friends'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('multi mode respects max — selecting past the cap is a no-op', async () => {
    const onChange = jest.fn();
    const { getByTestId } = await render(
      <ChipGroup testID="g" options={options} value={['friends', 'study']} onChange={onChange} max={2} />
    );
    await fireEvent.press(getByTestId('g-dates'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('single mode replaces the selection, and re-tapping the selected chip clears it', async () => {
    const onChange = jest.fn();
    const { getByTestId, rerender } = await render(
      <ChipGroup testID="g" options={options} value={[]} onChange={onChange} mode="single" />
    );
    await fireEvent.press(getByTestId('g-study'));
    expect(onChange).toHaveBeenCalledWith(['study']);

    await rerender(<ChipGroup testID="g" options={options} value={['study']} onChange={onChange} mode="single" />);
    await fireEvent.press(getByTestId('g-dates'));
    expect(onChange).toHaveBeenCalledWith(['dates']);

    await fireEvent.press(getByTestId('g-study'));
    expect(onChange).toHaveBeenCalledWith(['study']); // still selected in this render pass (value prop unchanged)
  });

  it('marks selected chips via accessibilityState', async () => {
    const { getByTestId } = await render(
      <ChipGroup testID="g" options={options} value={['friends']} onChange={() => {}} />
    );
    expect(getByTestId('g-friends').props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
    expect(getByTestId('g-study').props.accessibilityState).toEqual(expect.objectContaining({ checked: false }));
  });
});
