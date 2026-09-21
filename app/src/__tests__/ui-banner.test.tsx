import { fireEvent, render } from '@testing-library/react-native';
import { Banner, Toast } from '../ui/Banner';
import { colors } from '../theme/tokens';

describe('ui/Banner', () => {
  it('renders title and message', async () => {
    const { getByText } = await render(<Banner testID="b" title="a few rules" message="albums are private." />);
    expect(getByText('a few rules')).toBeTruthy();
    expect(getByText('albums are private.')).toBeTruthy();
  });

  it('tint tone (default) uses the tint fill', async () => {
    const { getByTestId } = await render(<Banner testID="b" message="x" />);
    const flat = [getByTestId('b').props.style].flat().filter(Boolean);
    expect(flat).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: colors.tint })]));
  });

  it('renders an action and fires it', async () => {
    const onAction = jest.fn();
    const { getByTestId } = await render(
      <Banner message="you're paused" actionLabel="Resume" onAction={onAction} actionTestID="resume" />
    );
    await fireEvent.press(getByTestId('resume'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('omits the action entirely without actionLabel/onAction', async () => {
    const { queryByText } = await render(<Banner message="x" />);
    expect(queryByText('Resume')).toBeNull();
  });
});

describe('ui/Toast', () => {
  it('renders the message', async () => {
    const { getByText } = await render(<Toast message="link copied" />);
    expect(getByText('link copied')).toBeTruthy();
  });

  it('renders an optional action', async () => {
    const onAction = jest.fn();
    const { getByTestId } = await render(<Toast testID="t" message="report sent" actionLabel="undo" onAction={onAction} />);
    await fireEvent.press(getByTestId('t-action'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
