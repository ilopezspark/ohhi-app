import { View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { colors, radii, shadows, spacing, type RadiusToken, type ShadowToken, type SpacingToken } from '../theme/tokens';

export interface SurfaceProps extends ViewProps {
  /** Background fill. Defaults to `colors.surface` (white) — the raised-card colour on `paper` everywhere in the screens. */
  backgroundColor?: string;
  radius?: RadiusToken;
  shadow?: ShadowToken;
  padding?: SpacingToken;
  style?: StyleProp<ViewStyle>;
}

/**
 * The generic raised container every card-like block in the screens is built
 * from: the "here now" status card (`Me.html`), the "more about me" card
 * (`Profile-Details.html`), album covers. Deliberately free of business
 * logic — it's a styled `View`, nothing more. The tinted, shadow-less info
 * panels ("a few rules", "be normal about it") are `Banner`'s `tone="tint"`,
 * not this — they read as a message, not a card.
 */
export function Surface({
  backgroundColor = colors.surface,
  radius = 'lg',
  shadow = 'xs',
  padding = 'lgXl',
  style,
  ...rest
}: SurfaceProps) {
  return (
    <View
      {...rest}
      style={[
        { backgroundColor, borderRadius: radii[radius], padding: spacing[padding] },
        shadows[shadow],
        style,
      ]}
    />
  );
}

/** `Surface` under its most common name/defaults — no visual difference, just the name call sites reach for most often. */
export const Card = Surface;
