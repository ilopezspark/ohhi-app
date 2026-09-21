import { render } from '@testing-library/react-native';
import { Card, Surface } from '../ui/Surface';
import { colors, radii, shadows, spacing } from '../theme/tokens';

describe('ui/Surface', () => {
  it('defaults to a white, shadowed, lg-radius container', async () => {
    const { getByTestId } = await render(<Surface testID="s" />);
    const flat = [getByTestId('s').props.style].flat().filter(Boolean);
    expect(flat).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lgXl }),
      ])
    );
    expect(flat).toEqual(expect.arrayContaining([expect.objectContaining(shadows.xs)]));
  });

  it('accepts overrides for backgroundColor/radius/shadow/padding', async () => {
    const { getByTestId } = await render(
      <Surface testID="s" backgroundColor={colors.tint} radius="xl" shadow="none" padding="xxl" />
    );
    const flat = [getByTestId('s').props.style].flat().filter(Boolean);
    expect(flat).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ backgroundColor: colors.tint, borderRadius: radii.xl, padding: spacing.xxl }),
      ])
    );
  });

  it('Card is Surface under another name', () => {
    expect(Card).toBe(Surface);
  });
});
