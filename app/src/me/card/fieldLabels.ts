import type { CardField } from '../../settings/vocab';

/**
 * Display copy for each of the private card's four groups (ruling 1/3),
 * shared by `PrivateCardView` (the read-only, lowercase group labels in
 * `02-private-card.png`) and the editor's `SectionLabel` headers (rendered
 * uppercase by `SectionLabel` itself — pass this lowercase copy through,
 * per that component's own doc comment).
 */
export const CARD_FIELD_LABELS: Record<CardField, string> = {
  into: 'into',
  safer_sex: 'safer sex',
  kinks: 'kinks',
  hard_nos: 'hard nos',
};
