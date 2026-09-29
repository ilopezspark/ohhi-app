import { fireEvent, render } from '@testing-library/react-native';
import { Input } from '../ui/Input';
import { colors, inputs, radii } from '../theme/tokens';

function flat(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
}

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

  it('sets every side of its padding from tokens, so neither platform adds its own', async () => {
    for (const multiline of [false, true]) {
      const { getByTestId } = await render(<Input testID="f" multiline={multiline} />);
      const style = flat(getByTestId('f-input').props.style);
      expect(style.paddingLeft).toBe(inputs.paddingX - inputs.ringWidth);
      expect(style.paddingRight).toBe(inputs.paddingX - inputs.ringWidth);
      expect(style.paddingTop).toBe(multiline ? inputs.paddingY - inputs.ringWidth : 0);
      expect(style.paddingBottom).toBe(multiline ? inputs.paddingY - inputs.ringWidth : 0);
      expect(style.includeFontPadding).toBe(false);
    }
  });

  it('every single-line field is the same fixed height, text centred', async () => {
    const { getByTestId } = await render(<Input testID="f" />);
    expect(flat(getByTestId('f-input').props.style)).toMatchObject({ height: inputs.height, textAlignVertical: 'center' });
  });

  it('multiline fields start at `rows` lines tall on a fixed line height and align text to the top', async () => {
    const { getByTestId } = await render(<Input testID="f" multiline rows={4} />);
    expect(flat(getByTestId('f-input').props.style)).toMatchObject({
      minHeight: inputs.paddingY * 2 + 4 * inputs.lineHeight,
      lineHeight: inputs.lineHeight,
      textAlignVertical: 'top',
    });
  });

  it('focusing never moves the text: the ring is always reserved, only its colour changes', async () => {
    const { getByTestId } = await render(<Input testID="f" />);
    const before = flat(getByTestId('f-input').props.style);
    await fireEvent(getByTestId('f-input'), 'focus');
    const after = flat(getByTestId('f-input').props.style);
    expect(before.borderWidth).toBe(inputs.ringWidth);
    expect(after.borderWidth).toBe(inputs.ringWidth);
    expect(before.borderColor).toBe('transparent');
    expect(after.borderColor).toBe(colors.ink);
    expect(after.paddingLeft).toBe(before.paddingLeft);
  });

  it('on a card the field takes the paper fill so it stays visible', async () => {
    const { getByTestId } = await render(<Input testID="f" surface="card" />);
    expect(flat(getByTestId('f-input').props.style).backgroundColor).toBe(colors.paper);
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
