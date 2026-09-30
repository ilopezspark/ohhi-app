import { StyleSheet, Text, TextInput, View } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaInsetsContext, type EdgeInsets } from 'react-native-safe-area-context';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';

jest.mock('../api/client', () => ({ supabase: {} }));

import { FOCUSED_FIELD_GAP, focusedFieldOffset, keyboardSpacerHeight } from '../ui/keyboardInset';
import { KeyboardFooter, KeyboardScrollView } from '../ui/KeyboardScrollView';
import { OnboardingScreen } from '../onboarding/components/OnboardingScreen';
import { TagPicker } from '../tags/TagPicker';

/**
 * `ui/KeyboardScrollView` on react-native-keyboard-controller. Under Jest the
 * library's own mock stands in (`jest.setup.ts`): `KeyboardAwareScrollView`
 * is a plain `ScrollView` that receives the props we pass, and
 * `useReanimatedKeyboardAnimation` reports a closed keyboard unless a test
 * opens it (`keyboardAt`).
 */

const insets = (bottom: number): EdgeInsets => ({ top: 24, bottom, left: 0, right: 0 });

/** Makes the mocked keyboard report `height` (dp from the bottom of the screen) until restored. */
function keyboardAt(height: number) {
  const mock = useReanimatedKeyboardAnimation as jest.Mock;
  const previous = mock();
  mock.mockReturnValue({ height: { value: -height }, progress: { value: height > 0 ? 1 : 0 } });
  return () => {
    mock.mockReturnValue(previous);
  };
}

function translateY(node: { props: { style?: unknown } }): number {
  const transform = (StyleSheet.flatten(node.props.style as never) as { transform?: { translateY?: number }[] }).transform;
  return transform?.find((t) => t.translateY !== undefined)?.translateY ?? 0;
}

async function layout(node: Parameters<typeof fireEvent>[0], height: number) {
  await fireEvent(node, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } });
}

describe('ui/keyboardInset: focused field offset', () => {
  it('is the gap alone with no footer', () => {
    expect(focusedFieldOffset(FOCUSED_FIELD_GAP, 0)).toBe(FOCUSED_FIELD_GAP);
    expect(focusedFieldOffset(24, 0)).toBe(24);
  });

  it('adds the height of a footer riding on the keyboard, which the field has to clear', () => {
    expect(focusedFieldOffset(72, 76)).toBe(148);
  });

  it('treats negative values as zero', () => {
    expect(focusedFieldOffset(-5, 40)).toBe(40);
    expect(focusedFieldOffset(24, -10)).toBe(24);
  });

  it('leaves room for a helper line or a card footer row (36pt actions) under the field', () => {
    expect(FOCUSED_FIELD_GAP).toBeGreaterThanOrEqual(36 + 16 + 16);
  });

  it('lifts a footer by the whole keyboard when it keeps no inset of its own', () => {
    expect(keyboardSpacerHeight(300, 0)).toBe(300);
    expect(keyboardSpacerHeight(0, 0)).toBe(0);
  });
});

describe('ui/KeyboardScrollView', () => {
  it('is keyboard-aware: taps land while the keyboard is up, the field clears it by the default gap', async () => {
    const { getByTestId } = await render(
      <KeyboardScrollView testID="ksv">
        <TextInput testID="field" />
      </KeyboardScrollView>
    );
    const scroll = getByTestId('ksv');
    expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
    expect(scroll.props.bottomOffset).toBe(FOCUSED_FIELD_GAP);
  });

  it('pads the content by the keyboard only: no extra space, no iOS automatic inset on top', async () => {
    const { getByTestId } = await render(<KeyboardScrollView testID="ksv" />);
    const scroll = getByTestId('ksv');
    // The library adds `keyboard height + extraKeyboardSpace` below the content.
    expect(scroll.props.extraKeyboardSpace ?? 0).toBe(0);
    // iOS's own keyboard inset would stack on the library's.
    expect(scroll.props.automaticallyAdjustKeyboardInsets).toBeFalsy();
  });

  it('keeps the callers props (content style, a larger gap, an override)', async () => {
    const { getByTestId } = await render(
      <KeyboardScrollView
        testID="ksv"
        bottomOffset={112}
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardDismissMode="on-drag"
      />
    );
    const scroll = getByTestId('ksv');
    expect(scroll.props.bottomOffset).toBe(112);
    expect(StyleSheet.flatten(scroll.props.contentContainerStyle).paddingBottom).toBe(32);
    expect(scroll.props.keyboardDismissMode).toBe('on-drag');
  });

  it('renders a footer that rides the keyboard, and the focused field clears the footer too', async () => {
    const restore = keyboardAt(300);
    try {
      const { getByTestId } = await render(
        <KeyboardScrollView testID="ksv" footer={<Text>continue</Text>} footerTestID="cta">
          <TextInput testID="field" />
        </KeyboardScrollView>
      );
      const footer = getByTestId('cta');
      expect(translateY(footer)).toBe(-300);
      await layout(footer, 76);
      expect(getByTestId('ksv').props.bottomOffset).toBe(FOCUSED_FIELD_GAP + 76);
    } finally {
      restore();
    }
  });

  it('leaves the footer in place while the keyboard is down', async () => {
    const { getByTestId } = await render(<KeyboardScrollView testID="ksv" footer={<Text>done</Text>} footerTestID="cta" />);
    expect(translateY(getByTestId('cta'))).toBe(0);
  });
});

describe('ui/KeyboardFooter', () => {
  it('lifts by the keyboard less the inset it keeps below itself (never both)', async () => {
    const restore = keyboardAt(300);
    try {
      const { getByTestId } = await render(
        <KeyboardFooter bottomInset={24} testID="bar">
          <View />
        </KeyboardFooter>
      );
      expect(translateY(getByTestId('bar'))).toBe(-276);
    } finally {
      restore();
    }
  });
});

describe('OnboardingScreen keyboard handling', () => {
  function screen() {
    return (
      <SafeAreaInsetsContext.Provider value={insets(24)}>
        <OnboardingScreen step={2} onBack={() => {}} testID="onb" footer={<Text testID="onb-continue">continue</Text>}>
          <TextInput testID="onb-field" />
        </OnboardingScreen>
      </SafeAreaInsetsContext.Provider>
    );
  }

  it('scrolls its body with the keyboard-aware scroll view, fields included', async () => {
    const { getByTestId } = await render(screen());
    const scroll = getByTestId('onb-scroll');
    expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
    expect(scroll.props.bottomOffset).toBe(FOCUSED_FIELD_GAP);
    expect(getByTestId('onb-field')).toBeTruthy();
    expect(translateY(getByTestId('onb-footer'))).toBe(0);
  });

  it('keeps the footer button on the keyboard, and the focused field above the footer', async () => {
    const restore = keyboardAt(320);
    try {
      const { getByTestId } = await render(screen());
      const footer = getByTestId('onb-footer');
      expect(translateY(footer)).toBe(-320);
      expect(getByTestId('onb-continue')).toBeTruthy();
      await layout(footer, 84);
      expect(getByTestId('onb-scroll').props.bottomOffset).toBe(FOCUSED_FIELD_GAP + 84);
    } finally {
      restore();
    }
  });

  it('has no footer bar when the screen passes none', async () => {
    const { queryByTestId } = await render(
      <OnboardingScreen testID="bare">
        <TextInput />
      </OnboardingScreen>
    );
    expect(queryByTestId('bare-footer')).toBeNull();
    expect(queryByTestId('bare-scroll')).toBeTruthy();
  });
});

describe('TagPicker keyboard handling', () => {
  function picker(bottom: number) {
    return (
      <SafeAreaInsetsContext.Provider value={insets(bottom)}>
        <TagPicker
          testID="picker"
          title="interests"
          closeLabel="cancel"
          onClose={() => {}}
          catalog={[]}
          selected={[]}
          onChange={() => {}}
          min={0}
          verb="done"
          onSubmit={() => {}}
        />
      </SafeAreaInsetsContext.Provider>
    );
  }

  it('adds nothing under the CTA while the keyboard is down', async () => {
    const { getByTestId } = await render(picker(24));
    expect(StyleSheet.flatten(getByTestId('picker-keyboard').props.style).height).toBe(0);
  });

  it('lifts the CTA onto the keyboard, less the inset it already keeps (no double inset)', async () => {
    const restore = keyboardAt(300);
    try {
      const { getByTestId } = await render(picker(24));
      // The CTA keeps 24 + 8 below the button; the 24 now sits over the
      // keyboard's own nav strip, so the button ends 8 above the keyboard.
      expect(StyleSheet.flatten(getByTestId('picker-keyboard').props.style).height).toBe(276);
      expect(getByTestId('picker-submit')).toBeTruthy();
    } finally {
      restore();
    }
  });
});
