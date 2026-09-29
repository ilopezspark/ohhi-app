import { splitMajor, type ProfileViewData } from '../../profile/view/model';
import type { ProfileEditorDraft, ProfileFieldsMeta, Tag } from './useProfileEditorDraft';

export interface PreviewDataInput {
  userId: string | null;
  firstName: string;
  gradYear: number | null;
  verified: boolean;
  campusShort: string | null;
  campusTags: Tag[];
  draft: ProfileEditorDraft;
  fieldsMeta: ProfileFieldsMeta | null;
  /** The caller's own photos (storage paths, position order) and their signed URLs. */
  photoPaths: string[];
  photoUrls: Record<string, string>;
  /** Live, from the presence store. */
  tier: ProfileViewData['tier'];
  hereNow: boolean;
}

/**
 * The owner's own `ProfileViewData` for the editor's Preview, so Preview and
 * the real profile render through the same `ProfileView`. Built from the
 * DRAFT (status, goals, tags, place line, prompts, usual places, so an
 * unsaved edit shows at once), plus `my_profile_fields()`'s join date and
 * place-line state, plus the live photos, tier and here-now.
 *
 * What others would see, with two owner-only differences the view itself
 * marks: gated prompts and usual places are included (with the "only shown
 * after a hi has been answered" note, drawn by `ProfileView` in `preview`),
 * and there is no "what you two share" (there is no second person).
 *
 * The place line follows the server's rule as far as the app can know it: a
 * saved line that is no longer showing (expired, or away) is left out; an
 * edited one is shown, since saving it starts a fresh two hours. The hero
 * drops it anyway whenever the tier has no word (away).
 */
export function buildPreviewData(input: PreviewDataInput): ProfileViewData {
  const { draft, fieldsMeta } = input;
  const labels = (draft.tagIds ?? [])
    .map((id) => input.campusTags.find((tag) => tag.id === id)?.label)
    .filter((label): label is string => !!label);
  const { majorLabel, otherTags } = splitMajor(labels, input.campusTags);

  const place = (draft.placeLine ?? '').trim();
  const savedPlace = (fieldsMeta?.savedPlaceLine ?? '').trim();
  const placeVisible = place.length > 0 && (place !== savedPlace || fieldsMeta?.placeLineShown === true);

  const usualPlaces = (draft.usualPlaces ?? []).map((p) => p.trim()).filter((p) => p.length > 0);
  const prompts = (draft.prompts ?? [])
    .filter((prompt) => prompt.answer.trim().length > 0)
    .map(({ promptId, question, answer, gated }) => ({ promptId, question, answer, gated }));

  return {
    userId: input.userId ?? 'me',
    firstName: input.firstName,
    gradYear: input.gradYear,
    statusLine: draft.statusLine?.trim() ? draft.statusLine : null,
    tier: input.tier,
    hereNow: input.hereNow,
    // No self-facing "online": previewing your own profile right now is
    // definitionally being online.
    isOnline: true,
    verified: input.verified,
    goals: draft.goals ?? [],
    majorLabel,
    tagLabels: otherTags,
    sharedLines: [],
    // Pronouns/orientation are their own opt-in read (`about you`), not part
    // of the draft; the Preview has never shown them.
    pronouns: null,
    orientation: [],
    campusShort: input.campusShort,
    photoPaths: input.photoPaths,
    photoUrls: input.photoUrls,
    placeLine: placeVisible ? place : null,
    prompts,
    usualPlaces: usualPlaces.length > 0 ? usualPlaces : null,
    gateOpen: false,
    joinedMonth: fieldsMeta?.joinedMonth ?? null,
    joinedRecency: fieldsMeta?.joinedRecency ?? null,
  };
}
