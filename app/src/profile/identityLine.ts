export interface IdentityLineInput {
  /** e.g. `"CLC"` — a campus's short name/slug, uppercased for display. */
  campusShort?: string | null;
  /** The label of the user's first tag of category `major`, if any (e.g. `"cs"`). Lowercase, matching the tag's own stored label — this doesn't reformat it. */
  majorLabel?: string | null;
  gradYear?: number | null;
}

/**
 * `docs/design/me-redesign/brief.md`'s Me-tab identity line: `CLC · cs '27`
 * — campus short name, the user's first `major`-category tag, and grad
 * year, degrading gracefully as parts go missing:
 *
 * - all three: `"CLC · cs '27"`
 * - no major: `"CLC · '27"`
 * - no grad year: `"CLC · cs"`
 * - major + grad year, no campus: `"cs '27"`
 * - only one part: that part alone
 * - nothing: `""`
 */
export function identityLine({ campusShort, majorLabel, gradYear }: IdentityLineInput): string {
  const gradPart = gradYear ? `'${String(gradYear).slice(-2)}` : null;
  const majorAndGrad = [majorLabel, gradPart].filter(Boolean).join(' ');
  return [campusShort, majorAndGrad || null].filter(Boolean).join(' · ');
}
