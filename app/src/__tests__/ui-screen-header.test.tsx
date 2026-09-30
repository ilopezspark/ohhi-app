import { StyleSheet, Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaInsetsContext, type EdgeInsets } from 'react-native-safe-area-context';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { HEADER_GUTTER, HEADER_TOP_GAP, headerTop, statusBarInset } from '../ui/screenInsets';
import { bottomRoom, keyboardSpacerHeight } from '../ui/keyboardInset';
import { ScreenHeader } from '../ui/ScreenHeader';
import { KeyboardSpacer } from '../ui/KeyboardSpacer';
import { spacing } from '../theme/tokens';

const insets = (top: number, bottom = 0): EdgeInsets => ({ top, bottom, left: 0, right: 0 });

function withInsets(value: EdgeInsets | null, node: React.ReactElement) {
  return <SafeAreaInsetsContext.Provider value={value}>{node}</SafeAreaInsetsContext.Provider>;
}

/** Makes the mocked keyboard report `height` (dp from the bottom of the screen) until restored. */
function keyboardAt(height: number) {
  const mock = useReanimatedKeyboardAnimation as jest.Mock;
  const original = mock.getMockImplementation();
  const previous = mock();
  mock.mockReturnValue({ height: { value: -height }, progress: { value: height > 0 ? 1 : 0 } });
  return () => {
    if (original) mock.mockImplementation(original);
    mock.mockReturnValue(previous);
  };
}

describe('ui/screenInsets', () => {
  it('matches the Me screen: 12 below the status bar, 16 side gutter', () => {
    expect(HEADER_TOP_GAP).toBe(spacing.mdLg);
    expect(HEADER_TOP_GAP).toBe(12);
    expect(HEADER_GUTTER).toBe(spacing.lgXl);
    expect(HEADER_GUTTER).toBe(16);
    expect(headerTop(24)).toBe(36);
  });

  it('uses the safe-area top when it is known (covers a punch-hole or notch)', () => {
    expect(statusBarInset(48, 'android', 24)).toBe(48);
    expect(statusBarInset(59, 'ios', undefined)).toBe(59);
  });

  it('falls back to the status bar height on Android when the inset is 0 or missing', () => {
    expect(statusBarInset(0, 'android', 31)).toBe(31);
    expect(statusBarInset(undefined, 'android', 24)).toBe(24);
    expect(statusBarInset(null, 'android', null)).toBe(0);
  });

  it('never invents an inset on iOS or web', () => {
    expect(statusBarInset(0, 'ios', 20)).toBe(0);
    expect(statusBarInset(0, 'web', 20)).toBe(0);
  });
});

describe('ui/keyboardInset', () => {
  it('adds nothing while the keyboard is down', () => {
    expect(keyboardSpacerHeight(0, 24)).toBe(0);
    expect(bottomRoom(0, 24)).toBe(24);
  });

  it('adds only what the keyboard needs beyond the bottom inset (no double inset)', () => {
    // Edge-to-edge Android: the keyboard's 300 already covers the 24 nav bar strip.
    expect(keyboardSpacerHeight(300, 24)).toBe(276);
    expect(bottomRoom(300, 24)).toBe(300);
    // iOS: the 336 keyboard includes the 34 home indicator area.
    expect(bottomRoom(336, 34)).toBe(336);
  });

  it('keeps the inset while a keyboard is shorter than it (a floating or split keyboard)', () => {
    expect(keyboardSpacerHeight(10, 24)).toBe(0);
    expect(bottomRoom(10, 24)).toBe(24);
  });

  it('treats negative values as zero', () => {
    expect(keyboardSpacerHeight(-5, 24)).toBe(0);
    expect(keyboardSpacerHeight(100, -3)).toBe(100);
  });
});

describe('ui/ScreenHeader', () => {
  it('pads the heading below the status bar with the shared gutter', async () => {
    const { getByTestId } = await render(withInsets(insets(32), <ScreenHeader title="settings" testID="hdr" />));
    const style = StyleSheet.flatten(getByTestId('hdr-strip').props.style);
    expect(style.paddingTop).toBe(32 + 12);
    expect(style.paddingHorizontal).toBe(16);
    // Starts at the very top, so the paper background runs up behind the status bar.
    expect(style.marginTop ?? 0).toBe(0);
    expect(style.backgroundColor).toBeTruthy();
  });

  it('still clears the gap with no provider mounted', async () => {
    const { getByTestId } = await render(withInsets(null, <ScreenHeader title="x" testID="hdr" />));
    expect(StyleSheet.flatten(getByTestId('hdr-strip').props.style).paddingTop).toBeGreaterThanOrEqual(12);
  });

  it('shows a back arrow that goes back, and a lowercase title', async () => {
    const onBack = jest.fn();
    const { getByLabelText, getByText } = await render(
      withInsets(insets(24), <ScreenHeader title="My Campus" onBack={onBack} />)
    );
    await fireEvent.press(getByLabelText('Back'));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(getByText('my campus')).toBeTruthy();
  });

  it('offers a close x for a modal screen', async () => {
    const { getByLabelText } = await render(
      withInsets(insets(24), <ScreenHeader onBack={() => {}} backIcon="close" backTestID="x" />)
    );
    expect(getByLabelText('Close')).toBeTruthy();
  });

  it('renders the center and right slots', async () => {
    const { getByTestId } = await render(
      withInsets(
        insets(24),
        <ScreenHeader center={<Text testID="c">c</Text>} right={<Text testID="r">r</Text>} />
      )
    );
    expect(getByTestId('c')).toBeTruthy();
    expect(getByTestId('r')).toBeTruthy();
  });
});

describe('ui/KeyboardSpacer', () => {
  it('is empty while the keyboard is down', async () => {
    const { getByTestId } = await render(<KeyboardSpacer bottomInset={24} testID="sp" />);
    expect(StyleSheet.flatten(getByTestId('sp').props.style).height).toBe(0);
  });

  it('grows by the keyboard less the inset the bar above already keeps', async () => {
    const restore = keyboardAt(300);
    try {
      const { getByTestId } = await render(<KeyboardSpacer bottomInset={24} testID="sp" />);
      expect(StyleSheet.flatten(getByTestId('sp').props.style).height).toBe(276);
    } finally {
      restore();
    }
  });
});
