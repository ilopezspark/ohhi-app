import { fireEvent, render } from '@testing-library/react-native';
import { Input } from '../ui/Input';
import { colors, radii } from '../theme/tokens';

describe('ui/Input', () => {
  it('renders a label and calls onChangeText', async () => {
    const onChangeText = jest.fn();
    const { getByTestId, getByText } = await render(
      <Input testID="email" label="school email" onChangeText={onChangeText} />
    );
    expect(getByText('school email')).toBeTruthy();
    await fireEvent.changeText(getByTestId('email-input'), 'a@b.edu');
    expect(onChangeText).toHaveBeenCalledWith('a@b.edu');
  });

  it('single-line fields use the full pill radius', async () => {
    const { getByTestId } = await render(<Input testID="email" />);
    const flat = [getByTestId('email-input').props.style].flat().filter(Boolean);
    expect(flat).toEqual(expect.arrayContaining([expect.objectContaining({ borderRadius: radii.pill })]));
  });

  it('multiline fields (.field textarea) use the 22px radius instead', async () => {
    const { getByTestId } = await render(<Input testID="status" multiline />);
    const flat = [getByTestId('status-input').props.style].flat().filter(Boolean);
    expect(flat).toEqual(expect.arrayContaining([expect.objectContaining({ borderRadius: radii.lg })]));
    expect(getByTestId('status-input').props.multiline).toBe(true);
  });

  it('shows helper text when there is no error', async () => {
    const { getByText, queryByText } = await render(<Input helper="only used to check you're a student" />);
    expect(getByText("only used to check you're a student")).toBeTruthy();
    expect(queryByText('required')).toBeNull();
  });

  it('an error replaces the helper and tints the border red', async () => {
    const { getByTestId, getByText, queryByText } = await render(
      <Input testID="email" helper="helper copy" error="required" />
    );
    expect(getByText('required')).toBeTruthy();
    expect(queryByText('helper copy')).toBeNull();
    const flat = [getByTestId('email-input').props.style].flat().filter(Boolean);
    expect(flat).toEqual(expect.arrayContaining([expect.objectContaining({ borderColor: colors.danger })]));
  });
});
