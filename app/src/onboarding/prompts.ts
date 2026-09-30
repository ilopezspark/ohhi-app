/**
 * The onboarding prompts step's answer list, kept pure so it is unit-testable
 * without a screen. `set_my_prompts` replaces the whole list, so every save
 * sends the answers already stored plus the one being saved, in the order the
 * person sees them (`api/profileFields.ts#setMyPrompts`).
 */
export interface PromptEntry {
  promptId: string;
  question: string;
  gated: boolean;
  /** What is in the box now. */
  answer: string;
  /** What the server has stored for this prompt; null until the first save. */
  savedAnswer: string | null;
}

/** A trimmed, non-blank answer that differs from what is stored. */
export function isDirty(entry: PromptEntry): boolean {
  const text = entry.answer.trim();
  return text.length > 0 && text !== entry.savedAnswer;
}

/**
 * Which answers a save sends. `only` is one entry's index (save that answer),
 * `'all'` (continue: save every answer that changed) or `'none'` (resend what
 * is stored, used after a removal). An entry that is not being saved sends
 * its stored answer, or is left out when it has none; an entry being saved
 * whose box was emptied falls back to its stored answer the same way.
 */
export function payloadFor(entries: PromptEntry[], only: number | 'all' | 'none'): { promptId: string; answer: string }[] {
  const out: { promptId: string; answer: string }[] = [];
  entries.forEach((entry, index) => {
    const saving = only === 'all' || only === index;
    const typed = entry.answer.trim();
    const text = saving && typed.length > 0 ? typed : entry.savedAnswer;
    if (text) out.push({ promptId: entry.promptId, answer: text });
  });
  return out;
}

/** Marks the sent answers as stored (by prompt id, so a list that changed while the save ran stays correct). */
export function markSaved(entries: PromptEntry[], sent: { promptId: string; answer: string }[]): PromptEntry[] {
  const byId = new Map(sent.map((s) => [s.promptId, s.answer]));
  return entries.map((entry) => (byId.has(entry.promptId) ? { ...entry, savedAnswer: byId.get(entry.promptId) ?? null } : entry));
}

/** The stored answers first (the editor's order), then anything started on this screen that is not among them. */
export function mergeStored(
  current: PromptEntry[],
  stored: { promptId: string; question: string; gated: boolean; answer: string }[]
): PromptEntry[] {
  const storedIds = new Set(stored.map((s) => s.promptId));
  const loaded = stored.map((s) => ({ promptId: s.promptId, question: s.question, gated: s.gated, answer: s.answer, savedAnswer: s.answer }));
  return [...loaded, ...current.filter((e) => !storedIds.has(e.promptId))];
}
