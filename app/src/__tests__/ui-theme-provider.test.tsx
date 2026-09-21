import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { theme, ThemeProvider, useTheme } from '../theme';
import { colors } from '../theme/tokens';

function Consumer() {
  const t = useTheme();
  return <Text testID="probe">{t.colors.signal}</Text>;
}

describe('theme/index', () => {
  it('theme is the light theme with the extracted colours', () => {
    expect(theme.colorScheme).toBe('light');
    expect(theme.colors.signal).toBe(colors.signal);
  });

  it('useTheme() outside a provider still returns the (only) theme', async () => {
    const { getByTestId } = await render(<Consumer />);
    expect(getByTestId('probe').props.children).toBe(colors.signal);
  });

  it('ThemeProvider provides the same theme to descendants', async () => {
    const { getByTestId } = await render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>
    );
    expect(getByTestId('probe').props.children).toBe(colors.signal);
  });
});
