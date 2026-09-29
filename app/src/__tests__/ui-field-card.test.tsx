import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { CardTextInput, FieldCard, FieldFooter } from '../ui/FieldCard';
import { inputs } from '../theme/tokens';

function flat(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
}

describe('ui/FieldCard', () => {
  it('owns the padding: the text inside starts at the card padding', async () => {
    const { getByTestId } = await render(
      <FieldCard testID="card">
        <CardTextInput testID="input" multiline />
      </FieldCard>
    );
    expect(flat(getByTestId('card').props.style).padding).toBe(inputs.cardPadding);
    const input = flat(getByTestId('input').props.style);
    // Every side set to 0: no Android EditText padding, no iOS multiline top inset.
    expect(input).toMatchObject({ paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0, includeFontPadding: false });
    expect(input).toMatchObject({ textAlignVertical: 'top', lineHeight: 24 });
  });

  it('a single-line input keeps a 44pt tap target without adding to the visual inset', async () => {
    const { getByTestId } = await render(<CardTextInput testID="input" size="body" />);
    const input = flat(getByTestId('input').props.style);
    expect(input.height).toBe(inputs.cardSingleLineHeight);
    expect(input.marginVertical).toBe(-(inputs.cardSingleLineHeight - inputs.lineHeight) / 2);
    expect(input.lineHeight).toBeUndefined();
    expect(input.textAlignVertical).toBe('center');
  });

  it('the footer draws the counter in its own row, beside the left action', async () => {
    const { getByTestId, getByText } = await render(
      <FieldFooter left={<Text>clear</Text>} counter={{ length: 12, max: 40, testID: 'counter' }} />
    );
    expect(getByText('clear')).toBeTruthy();
    expect(getByTestId('counter')).toHaveTextContent('12 / 40');
  });
});
