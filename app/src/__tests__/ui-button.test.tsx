import { fireEvent, render } from '@testing-library/react-native';
import { Button } from '../ui/Button';
import { colors } from '../theme/tokens';

describe('ui/Button', () => {
  it('renders the label and fires onPress', async () => {
    const onPress = jest.fn();
    const { getByTestId, getByText } = await render(<Button testID="btn" label="verify now" onPress={onPress} />);
    expect(getByText('verify now')).toBeTruthy();
    await fireEvent.press(getByTestId('btn'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('primary uses the signal fill', async () => {
    const { getByTestId } = await render(<Button testID="btn" label="x" variant="primary" />);
    const flat = [getByTestId('btn').props.style].flat().filter(Boolean);
    expect(flat).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: colors.signal })]));
  });

  it('secondary uses the ink fill', async () => {
    const { getByTestId } = await render(<Button testID="btn" label="x" variant="secondary" />);
    const flat = [getByTestId('btn').props.style].flat().filter(Boolean);
    expect(flat).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: colors.ink })]));
  });

  it('ghost and destructive render text in muted / danger colour respectively', async () => {
    const { getByText: getGhostText } = await render(<Button label="skip for now" variant="ghost" />);
    const ghostNode = getGhostText('skip for now');
    expect([ghostNode.props.style].flat()).toEqual(expect.arrayContaining([expect.objectContaining({ color: colors.muted })]));

    const { getByText: getDestructiveText } = await render(<Button label="delete my account" variant="destructive" />);
    const destructiveNode = getDestructiveText('delete my account');
    expect([destructiveNode.props.style].flat()).toEqual(
      expect.arrayContaining([expect.objectContaining({ color: colors.danger })])
    );
  });

  it('destructive uses the dedicated danger colour, distinct from signalPressed (decision 51)', async () => {
    const { getByText } = await render(<Button label="delete my account" variant="destructive" />);
    const node = getByText('delete my account');
    expect(colors.danger).not.toBe(colors.signalPressed);
    expect([node.props.style].flat()).toEqual(expect.arrayContaining([expect.objectContaining({ color: colors.danger })]));
    expect([node.props.style].flat()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ color: colors.signalPressed })])
    );
  });

  it('shows a spinner and blocks onPress while loading', async () => {
    const onPress = jest.fn();
    const { getByTestId, queryByText } = await render(<Button testID="btn" label="send" loading onPress={onPress} />);
    expect(queryByText('send')).toBeNull();
    await fireEvent.press(getByTestId('btn'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('blocks onPress while disabled', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(<Button testID="btn" label="send" disabled onPress={onPress} />);
    await fireEvent.press(getByTestId('btn'));
    expect(onPress).not.toHaveBeenCalled();
    expect(getByTestId('btn').props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
  });

  it('is full width by default and can opt out', async () => {
    const { getByTestId: full } = await render(<Button testID="btn" label="x" />);
    expect([full('btn').props.style].flat()).toEqual(expect.arrayContaining([expect.objectContaining({ width: '100%' })]));

    const { getByTestId: inline } = await render(<Button testID="btn" label="x" fullWidth={false} />);
    expect([inline('btn').props.style].flat()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ width: '100%' })])
    );
  });
});
