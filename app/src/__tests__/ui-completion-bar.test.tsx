import { render } from '@testing-library/react-native';
import { CompletionBar } from '../ui/CompletionBar';
import { colors } from '../theme/tokens';

describe('ui/CompletionBar', () => {
  it('shows the percent label by default', async () => {
    const { getByText } = await render(<CompletionBar percent={80} />);
    expect(getByText('80%')).toBeTruthy();
  });

  it('hides the label when showLabel is false', async () => {
    const { queryByText } = await render(<CompletionBar percent={80} showLabel={false} />);
    expect(queryByText('80%')).toBeNull();
  });

  it('the fill width matches the (clamped, rounded) percent', async () => {
    const { getByTestId } = await render(<CompletionBar testID="c" percent={42.6} />);
    const fill = getByTestId('c-fill');
    expect([fill.props.style].flat()).toEqual(expect.arrayContaining([expect.objectContaining({ width: '43%' })]));
  });

  it('clamps out-of-range percents to 0-100', async () => {
    const { getByTestId: getByTestIdLow } = await render(<CompletionBar testID="c" percent={-10} />);
    expect([getByTestIdLow('c-fill').props.style].flat()).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: '0%' })])
    );

    const { getByTestId: getByTestIdHigh } = await render(<CompletionBar testID="c2" percent={140} />);
    expect([getByTestIdHigh('c2-fill').props.style].flat()).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: '100%' })])
    );
  });

  it('the fill uses the signal colour, on a paperTint track', async () => {
    const { getByTestId } = await render(<CompletionBar testID="c" percent={50} />);
    expect([getByTestId('c-fill').props.style].flat()).toEqual(
      expect.arrayContaining([expect.objectContaining({ backgroundColor: colors.signal })])
    );
    expect([getByTestId('c-track').props.style].flat()).toEqual(
      expect.arrayContaining([expect.objectContaining({ backgroundColor: colors.paperTint })])
    );
  });

  it('exposes an accessible progressbar value', async () => {
    const { getByTestId } = await render(<CompletionBar testID="c" percent={65} />);
    const track = getByTestId('c-track');
    expect(track.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 65 });
    expect(track.props.accessibilityRole).toBe('progressbar');
  });
});
