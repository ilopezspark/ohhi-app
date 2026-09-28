import { Text as RNText, View } from 'react-native';
import { render } from '@testing-library/react-native';
import { RowCard } from '../ui/RowCard';
import { colors, hairline, radii } from '../theme/tokens';

describe('ui/RowCard', () => {
  it('renders a white, rounded container', async () => {
    const { getByTestId } = await render(
      <RowCard testID="rc">
        <View testID="row-1" />
      </RowCard>
    );
    const card = getByTestId('rc');
    expect([card.props.style].flat()).toEqual(
      expect.arrayContaining([expect.objectContaining({ backgroundColor: colors.paperRaised, borderRadius: radii.card })])
    );
  });

  it('adds a hairline divider under every row except the last', async () => {
    const { getByTestId } = await render(
      <RowCard>
        <View testID="row-1" />
        <View testID="row-2" />
        <View testID="row-3" />
      </RowCard>
    );
    expect([getByTestId('row-1').props.style].flat()).toEqual(
      expect.arrayContaining([expect.objectContaining({ borderBottomWidth: hairline.width, borderBottomColor: colors.lineSoft })])
    );
    expect([getByTestId('row-2').props.style].flat()).toEqual(
      expect.arrayContaining([expect.objectContaining({ borderBottomWidth: hairline.width })])
    );
    // Last row: no divider style object should be present.
    const lastStyle = [getByTestId('row-3').props.style].flat().filter(Boolean);
    expect(lastStyle).not.toEqual(expect.arrayContaining([expect.objectContaining({ borderBottomWidth: hairline.width })]));
  });

  it('filters out falsy children (conditional rows)', async () => {
    const showSecond = false;
    const { getByTestId, queryByTestId } = await render(
      <RowCard>
        <View testID="row-1" />
        {showSecond && <View testID="row-2" />}
        <View testID="row-3" />
      </RowCard>
    );
    expect(getByTestId('row-1')).toBeTruthy();
    expect(queryByTestId('row-2')).toBeNull();
    expect(getByTestId('row-3')).toBeTruthy();
    // With row-2 filtered out, row-1 (now second-to-last of the remaining
    // two) still gets a divider and row-3 (now last) does not.
    expect([getByTestId('row-1').props.style].flat()).toEqual(
      expect.arrayContaining([expect.objectContaining({ borderBottomWidth: hairline.width })])
    );
  });

  it('preserves non-element children (e.g. plain text) without crashing', async () => {
    const { getByText } = await render(
      <RowCard>
        <RNText>plain text child</RNText>
      </RowCard>
    );
    expect(getByText('plain text child')).toBeTruthy();
  });
});
