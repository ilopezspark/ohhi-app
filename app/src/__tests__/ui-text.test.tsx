import { render } from '@testing-library/react-native';
import { Text } from '../ui/Text';
import { colors, typography } from '../theme/tokens';

describe('ui/Text', () => {
  it('renders children and defaults to the body variant', async () => {
    const { getByText } = await render(<Text>hello</Text>);
    const node = getByText('hello');
    const flat = [node.props.style].flat();
    expect(flat).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fontSize: typography.body.fontSize, color: typography.body.color }),
      ])
    );
  });

  it.each(Object.keys(typography) as (keyof typeof typography)[])('applies the %s variant scale', async (variant) => {
    const { getByText } = await render(<Text variant={variant}>x</Text>);
    const node = getByText('x');
    const flat = [node.props.style].flat();
    expect(flat).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fontSize: typography[variant].fontSize,
          fontFamily: typography[variant].fontFamily,
          letterSpacing: typography[variant].letterSpacing,
        }),
      ])
    );
  });

  it('lets an explicit color override the variant default', async () => {
    const { getByText } = await render(
      <Text variant="body" color={colors.onDark}>
        on dark
      </Text>
    );
    const node = getByText('on dark');
    const flat = [node.props.style].flat();
    expect(flat).toEqual(expect.arrayContaining([expect.objectContaining({ color: colors.onDark })]));
  });

  it('forwards testID and numberOfLines', async () => {
    const { getByTestId } = await render(
      <Text testID="t" numberOfLines={1}>
        clipped
      </Text>
    );
    expect(getByTestId('t').props.numberOfLines).toBe(1);
  });
});
