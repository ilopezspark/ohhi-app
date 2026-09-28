import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { colors, typography, type TypeStyle, type TypographyVariant } from '../theme/tokens';

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
  // `typography[variant]`'s inferred type is the union of every individual
  // variant's own `as const` literal shape (only `sectionLabel` declares
  // `textTransform`), not the shared `TypeStyle` interface — widen it
  // explicitly so every variant's optional fields (currently just
  // `textTransform`) are accessible below regardless of which one it is.
  const scale: TypeStyle = typography[variant];
  const composed: TextStyle = {
    fontFamily: scale.fontFamily,
    fontSize: scale.fontSize,
    fontWeight: scale.fontWeight,
    lineHeight: scale.lineHeight,
    letterSpacing: scale.letterSpacing,
    color: color ?? scale.color,
    // Only `sectionLabel` (Me redesign) sets this — every other variant
    // leaves it undefined, which RN treats as "no transform".
    ...(scale.textTransform ? { textTransform: scale.textTransform } : null),
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
