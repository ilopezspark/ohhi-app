import type { UseProfileEditorDraftResult } from './useProfileEditorDraft';

/**
 * What the preview screen needs from the editor's draft state: the same
 * fields `buildPreviewData` reads besides photos, tier and here-now (those
 * are live and come from their own hooks).
 */
export type PreviewSource = Pick<
  UseProfileEditorDraftResult,
  'userId' | 'firstName' | 'gradYear' | 'verified' | 'campusShort' | 'catalog' | 'draft' | 'fieldsMeta'
>;

let current: PreviewSource | null = null;

/** Picks the preview's fields out of a draft state (the saved profile, or the editor's live draft). */
export function previewSourceOf(state: UseProfileEditorDraftResult): PreviewSource {
  return {
    userId: state.userId,
    firstName: state.firstName,
    gradYear: state.gradYear,
    verified: state.verified,
    campusShort: state.campusShort,
    catalog: state.catalog,
    draft: state.draft,
    fieldsMeta: state.fieldsMeta,
  };
}

/**
 * The editor hands its current draft to `/profile-preview?from=editor` here.
 * The preview route sits at the root of the stack, outside the editor's
 * `ProfileEditorDraftProvider`, so it cannot read the draft from context; this
 * one-slot hand-off is how an unsaved edit still shows in the preview. The
 * editor sets it on every press of `preview`, so a stale value is never read.
 */
export function setPreviewDraft(source: PreviewSource | null): void {
  current = source;
}

export function getPreviewDraft(): PreviewSource | null {
  return current;
}
