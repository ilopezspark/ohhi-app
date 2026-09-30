import { type ProfileViewData } from '../../profile/view/model';
import type { Audiences, IdentityCards } from '../../profile/fields';
import type { ProfileEditorDraft, ProfileFieldsMeta, Tag } from './useProfileEditorDraft';

export interface PreviewDataInput {
  userId: string | null;
  firstName: string;
  gradYear: number | null;
  verified: boolean;
  campusShort: string | null;
  /** `tag_catalog()`, to turn the draft's tag ids into labels. */
  catalog: Tag[];
  draft: ProfileEditorDraft;
  fieldsMeta: ProfileFieldsMeta | null;
  /** The caller's own photos (storage paths, position order) and their signed URLs. */
  photoPaths: string[];
  photoUrls: Record<string, string>;
  /** path -> "under review" for each pending photo (`photoStates.ts#previewPhotos`). The owner sees every photo they have, badged. */
  photoBadges?: Record<string, string>;
  /** Live, from the presence store. */
  tier: ProfileViewData['tier'];
  hereNow: boolean;
  /**
   * `getMyIdentity()`: every public card the owner has, whatever its
   * audience, plus the audiences (so each card not shown to everyone carries
   * its note). Null while it loads or when it failed: no cards.
   */
  identity?: { cards: Partial<IdentityCards>; audiences: Audiences } | null;
}

/**
 * The owner's own `ProfileViewData` for the editor's Preview, so Preview and
 * the real profile render through the same `ProfileView`. Built from the
 * DRAFT (status, goals, tags, place line, prompts, usual places and the
 * about section, so an unsaved edit shows at once), plus `my_profile_fields()`'s join date and
 * place-line state, plus the live photos, tier and here-now.
 *
 * What others would see, with three owner-only differences the view itself
 * marks: gated prompts and usual places are included (with the "only shown
 * after a hi has been answered" note, drawn by `ProfileView` in `preview`);
 * every filled public card is included whatever its audience, with a note on
 * the ones not shown to everyone ("only you can see this", "shown after a hi
 * is answered"); and there is no "what you two share" (there is no second
 * person).
 *
 * The place line follows the server's rule as far as the app can know it: a
 * saved line that is no longer showing (expired, or away) is left out; an
 * edited one is shown, since saving it starts a fresh two hours. The hero
 * drops it anyway whenever the tier has no word (away).
 */
export function buildPreviewData(input: PreviewDataInput): ProfileViewData {
  const { draft, fieldsMeta } = input;
  const byId = new Map(input.catalog.map((tag) => [tag.id, tag.label]));
  const labels = (draft.tagIds ?? []).map((id) => byId.get(id)).filter((label): label is string => !!label);
  const about = draft.about ?? null;

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
    gradYear: about ? about.graduatingYear : input.gradYear,
    statusLine: draft.statusLine?.trim() ? draft.statusLine : null,
    tier: input.tier,
    hereNow: input.hereNow,
    // No self-facing "online": previewing your own profile right now is
    // definitionally being online.
    isOnline: true,
    verified: input.verified,
    goals: draft.goals ?? [],
    majorLabel: about?.major?.label ?? null,
    tagLabels: labels,
    sharedLines: [],
    about,
    // The public cards are saved by their own editors, not the draft: the
    // preview screen reads them with `getMyIdentity()`.
    identityCards: input.identity?.cards ?? {},
    identityAudiences: input.identity?.audiences ?? null,
    campusShort: input.campusShort,
    photoPaths: input.photoPaths,
    photoUrls: input.photoUrls,
    photoBadges: input.photoBadges ?? {},
    placeLine: placeVisible ? place : null,
    prompts,
    usualPlaces: usualPlaces.length > 0 ? usualPlaces : null,
    gateOpen: false,
    joinedMonth: fieldsMeta?.joinedMonth ?? null,
    joinedRecency: fieldsMeta?.joinedRecency ?? null,
  };
}
