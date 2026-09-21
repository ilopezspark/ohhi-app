import { fireEvent, render } from '@testing-library/react-native';
import { MessageSheet } from '../card/MessageSheet';
import { MAX_OPENER_LENGTH } from '../chat/rules';

describe('MessageSheet', () => {
  it('renders nothing when not visible', async () => {
    const { queryByTestId } = await render(
      <MessageSheet visible={false} firstName="Ada" onSend={jest.fn()} onDismiss={jest.fn()} />
    );
    expect(queryByTestId('profile-message-sheet')).toBeNull();
  });

  it('keeps send disabled with an empty or all-whitespace draft, and enables it once there is real text', async () => {
    const { getByTestId } = await render(
      <MessageSheet visible firstName="Ada" onSend={jest.fn()} onDismiss={jest.fn()} />
    );
    const send = getByTestId('profile-message-sheet-send');
    expect(send.props.accessibilityState?.disabled).toBe(true);

    await fireEvent.changeText(getByTestId('profile-message-sheet-input'), '   ');
    expect(send.props.accessibilityState?.disabled).toBe(true);

    await fireEvent.changeText(getByTestId('profile-message-sheet-input'), '  hi there  ');
    expect(send.props.accessibilityState?.disabled).toBe(false);
  });

  it('caps the draft at MAX_OPENER_LENGTH (chat/rules.ts\'s opener limit) and shows a matching counter', async () => {
    const { getByTestId, getByText } = await render(
      <MessageSheet visible firstName="Ada" onSend={jest.fn()} onDismiss={jest.fn()} />
    );
    const input = getByTestId('profile-message-sheet-input');
    const tooLong = 'x'.repeat(MAX_OPENER_LENGTH + 50);

    await fireEvent.changeText(input, tooLong);

    expect(input.props.value).toHaveLength(MAX_OPENER_LENGTH);
    expect(getByText(`${MAX_OPENER_LENGTH} / ${MAX_OPENER_LENGTH}`)).toBeTruthy();
  });

  it('calls onSend with the trimmed draft, not the raw padded text', async () => {
    const onSend = jest.fn();
    const { getByTestId } = await render(
      <MessageSheet visible firstName="Ada" onSend={onSend} onDismiss={jest.fn()} />
    );
    await fireEvent.changeText(getByTestId('profile-message-sheet-input'), '  hey, saw you around  ');
    await fireEvent.press(getByTestId('profile-message-sheet-send'));

    expect(onSend).toHaveBeenCalledWith('hey, saw you around');
  });

  it('disables send while busy even with a draft typed', async () => {
    const { getByTestId } = await render(
      <MessageSheet visible firstName="Ada" busy onSend={jest.fn()} onDismiss={jest.fn()} />
    );
    await fireEvent.changeText(getByTestId('profile-message-sheet-input'), 'hi');
    expect(getByTestId('profile-message-sheet-send').props.accessibilityState?.disabled).toBe(true);
  });
});
