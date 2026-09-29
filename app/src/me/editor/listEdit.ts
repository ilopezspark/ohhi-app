/** Moves the item at `from` to `to`, returning a new list (the same list when the move is out of range or a no-op). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** The prompts editor's line under an empty answer when `save` is tapped. */
export const BLANK_ANSWER_ERROR = 'write an answer, or remove this one.';

/** The usual-places editor's line under a repeated entry (the server compares trimmed and lower-cased). */
export const REPEATED_PLACE_ERROR = 'that place is already on your list.';

/** The usual-places editor's note: when these show, and that nothing gives away whether any are set before then. */
export const USUAL_PLACES_GATE_NOTE =
  "someone only sees these once a hi between you two has been answered. before that, your profile doesn't show whether you've added any.";
