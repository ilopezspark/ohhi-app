import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { colors, typography, type TypographyVariant } from '../theme/tokens';

export interface TextProps extends RNTextProps {
  /** Type-scale role, see `theme/tokens.ts#typography`. Defaults to `'body'`. */
  variant?: TypographyVariant;
  /** Overrides the variant's own colour (e.g. `colors.onDark` for text on a dark/signal surface). */
  color?: string;
}

/**
 * The one `Text` primitive every other component in this kit renders through.
 * `variant` maps straight onto `theme/tokens.ts#typography` — see that file
 * for which design screen each variant came from and its size overrides.
 */
export function Text({ variant = 'body', color, style, ...rest }: TextProps) {
  const scale = typography[variant];
  const composed: TextStyle = {
    fontFamily: scale.fontFamily,
    fontSize: scale.fontSize,
    fontWeight: scale.fontWeight,
    lineHeight: scale.lineHeight,
    letterSpacing: scale.letterSpacing,
    color: color ?? scale.color,
  };
  return <RNText {...rest} style={[composed, style]} />;
}

/** Convenience re-export so call sites that only need the ink/muted/subtle triad don't have to reach into tokens. */
export const textColors = {
  ink: colors.ink,
  muted: colors.muted,
  subtle: colors.subtle,
  faint: colors.faint,
  onDark: colors.onDark,
} as const;
