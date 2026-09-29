import { render } from '@testing-library/react-native';
import { displayName } from '../ui';
import { CtaButton } from '../card/CtaButton';
import { MessageSheet } from '../card/MessageSheet';

describe('displayName (owner ruling: names in titles are lowercase)', () => {
  it('lowercases for display and trims', () => {
    expect(displayName('Tyler')).toBe('tyler');
    expect(displayName('  McKenna ')).toBe('mckenna');
    expect(displayName('ÉLODIE')).toBe('élodie');
  });

  it('is empty for a missing name, so callers can fall back', () => {
    expect(displayName(null)).toBe('');
    expect(displayName(undefined)).toBe('');
    expect(displayName(null) || 'someone').toBe('someone');
  });

  it('the one-message sheet names the person in lowercase', async () => {
    const screen = await render(
      <MessageSheet visible firstName="Tyler" tint="#ECE6DA" subtitle="on campus" busy={false} onSend={jest.fn()} onDismiss={jest.fn()} />
    );
    expect(screen.getByText('one message to tyler')).toBeTruthy();
  });
});

describe('CtaButton — hi sent', () => {
  const flat = (node: { props: { style?: unknown } }) => {
    const style = typeof node.props.style === 'function' ? node.props.style({ pressed: false }) : node.props.style;
    return Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
  };

  it.each(['photo', 'paper'] as const)('on %s: disabled, no message button, and not faded to half strength', async (appearance) => {
    const screen = await render(<CtaButton cta={{ kind: 'hi_sent' }} appearance={appearance} onHi={jest.fn()} onMessage={jest.fn()} />);
    const hi = screen.getByTestId('profile-cta-hi');
    expect(hi.props.accessibilityState).toEqual({ disabled: true });
    expect(hi).toHaveTextContent('hi sent');
    expect(screen.queryByTestId('profile-cta-message')).toBeNull();
    expect(flat(hi).opacity).toBeUndefined();
    // Not the say-hi orange: a settled state, drawn neutral.
    expect(flat(hi).backgroundColor).not.toBe('#FF5A1F');
  });

  it('an in-flight hi is still faded', async () => {
    const screen = await render(<CtaButton cta={{ kind: 'hi_and_message' }} hiBusy onHi={jest.fn()} onMessage={jest.fn()} />);
    expect(flat(screen.getByTestId('profile-cta-hi')).opacity).toBe(0.5);
  });
});
