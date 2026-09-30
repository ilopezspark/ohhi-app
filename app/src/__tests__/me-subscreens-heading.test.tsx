import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true), push: jest.fn() },
  useLocalSearchParams: () => ({ slug: 'privacy' }),
}));

import { router } from 'expo-router';
import ReportHelpScreen from '../app/me/report-help';
import InfoScreen from '../app/me/info/[slug]';

/**
 * The Me sub-screens moved onto the shared heading (owner ruling, 29
 * September 2026): the heading sits 12 below the status bar with the 16
 * gutter, like the Me tab, and the back button shows its arrow.
 */
describe.each([
  ['report help', ReportHelpScreen],
  ['info', InfoScreen],
])('%s heading', (_name, Screen) => {
  it('sits at the shared heading padding and goes back', async () => {
    const screen = await render(
      <SafeAreaInsetsContext.Provider value={{ top: 30, bottom: 20, left: 0, right: 0 }}>
        <Screen />
      </SafeAreaInsetsContext.Provider>
    );
    const strip = StyleSheet.flatten(screen.getByTestId('screen-header').props.style);
    expect(strip.paddingTop).toBe(42);
    expect(strip.paddingHorizontal).toBe(16);
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(router.back).toHaveBeenCalled();
  });

  it('goes to the Me tab when there is no history (reload, deep link)', async () => {
    (router.canGoBack as jest.Mock).mockReturnValueOnce(false);
    const screen = await render(
      <SafeAreaInsetsContext.Provider value={{ top: 30, bottom: 20, left: 0, right: 0 }}>
        <Screen />
      </SafeAreaInsetsContext.Provider>
    );
    (router.back as jest.Mock).mockClear();
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/(tabs)/settings');
  });
});
