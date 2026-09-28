import { fireEvent, render } from '@testing-library/react-native';
import { SettingsRow } from '../ui/SettingsRow';
import { colors } from '../theme/tokens';

describe('ui/SettingsRow', () => {
  it('renders the title and optional subtitle', async () => {
    const { getByText } = await render(
      <SettingsRow title="private card" subtitle="shared with 3 people" />
    );
    expect(getByText('private card')).toBeTruthy();
    expect(getByText('shared with 3 people')).toBeTruthy();
  });

  it('renders a leading icon tile when icon is given', async () => {
    const { getByTestId, queryByTestId } = await render(
      <SettingsRow testID="row" title="albums" icon="image" />
    );
    expect(getByTestId('row')).toBeTruthy();
    // No crash / no accessory rendered when none is given.
    expect(queryByTestId('row-accessory')).toBeNull();
  });

  it('chevron accessory renders and the row is pressable with onPress', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(
      <SettingsRow testID="row" title="my campus" accessory={{ kind: 'chevron' }} onPress={onPress} />
    );
    expect(getByTestId('row-accessory')).toBeTruthy();
    expect(getByTestId('row').props.accessibilityRole).toBe('button');
    await fireEvent.press(getByTestId('row'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('toggle accessory renders a switch and reports its value', async () => {
    const onValueChange = jest.fn();
    const { getByTestId } = await render(
      <SettingsRow
        testID="row"
        title="here now"
        accessory={{ kind: 'toggle', value: true, onValueChange }}
      />
    );
    const toggle = getByTestId('row-accessory');
    expect(toggle.props.accessibilityRole).toBe('switch');
    expect(toggle.props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
    await fireEvent.press(toggle);
    expect(onValueChange).toHaveBeenCalledWith(false);
  });

  it('a row with only a toggle accessory and no onPress does not render a button role', async () => {
    const { getByTestId, queryByRole } = await render(
      <SettingsRow testID="row" title="here now" accessory={{ kind: 'toggle', value: false, onValueChange: () => {} }} />
    );
    expect(getByTestId('row')).toBeTruthy();
    expect(queryByRole('button')).toBeNull();
  });

  it('badge accessory renders the label', async () => {
    const { getByText } = await render(
      <SettingsRow title="verification" accessory={{ kind: 'badge', label: 'verified' }} />
    );
    expect(getByText('verified')).toBeTruthy();
  });

  it('value accessory renders the text', async () => {
    const { getByText } = await render(
      <SettingsRow title="school email" accessory={{ kind: 'value', text: 'ada@clc.edu' }} />
    );
    expect(getByText('ada@clc.edu')).toBeTruthy();
  });

  it('danger renders the title in the danger colour, not boundaryInk (ruling 8: boundary colours are hard-nos only)', async () => {
    const { getByText } = await render(<SettingsRow title="delete my account" danger onPress={() => {}} />);
    const node = getByText('delete my account');
    expect([node.props.style].flat()).toEqual(expect.arrayContaining([expect.objectContaining({ color: colors.danger })]));
  });

  it('meets the 44pt minimum touch target', async () => {
    const { getByTestId } = await render(<SettingsRow testID="row" title="x" onPress={() => {}} />);
    const flat = [getByTestId('row').props.style].flat().filter(Boolean);
    expect(flat).toEqual(expect.arrayContaining([expect.objectContaining({ minHeight: 44 })]));
  });

  it('disabled blocks onPress', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(<SettingsRow testID="row" title="x" onPress={onPress} disabled />);
    await fireEvent.press(getByTestId('row'));
    expect(onPress).not.toHaveBeenCalled();
  });
});
