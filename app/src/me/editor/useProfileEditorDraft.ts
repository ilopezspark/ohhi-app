import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { me as fetchMe } from '../../api/me';
import { getFirstName, getStatusLine, updateProfile } from '../../api/profile';
import { getUserGoals, setUserGoals, type UserGoal } from '../../api/goals';
import { getUserTags, listTagCatalog, minTagsToSave, setMyTags, type Tag } from '../../api/tags';
import { getMyAbout, setMyAbout } from '../../api/about';
import { listMyPhotos } from '../../api/photos';
import {
  getMyProfileFields,
  setMyPlaceLine,
  setMyPrompts,
  setMyUsualPlaces,
  type JoinedRecency,
} from '../../api/profileFields';
import { profileCompletion, type ProfileCompletionResult } from '../../profile/completion';
import { fieldErrorMessage } from '../../profile/fields';
import { aboutPatch, EMPTY_ABOUT, sameAbout, type AboutSection } from '../../profile/about';
import { queryKeys } from '../queryKeys';

export type { UserGoal, Tag };

/** One prompt answer in the draft. `question`/`gated` travel with it so the editor and Preview can render it without another lookup. */
export interface DraftPrompt {
  promptId: string;
  question: string;
  gated: boolean;
  answer: string;
}

export interface ProfileEditorDraft {
  statusLine: string;
  goals: UserGoal[];
  /** Interest tag ids, in picked order (migration 0018: up to 10). */
  tagIds: string[];
  /** Migration 0015. `''` = no place line. */
  placeLine: string;
  usualPlaces: string[];
  prompts: DraftPrompt[];
  /** Migration 0018's about section (major, minor, graduating, work). */
  about: AboutSection;
}

export type DraftField = keyof ProfileEditorDraft;

/** The read-only side of `my_profile_fields()` the editor and Preview need besides the draft values. */
export interface ProfileFieldsMeta {
  /** The saved place line (what `placeLineShown`/`placeLineUntil` describe). */
  savedPlaceLine: string | null;
  placeLineUntil: string | null;
  placeLineShown: boolean;
  joinedMonth: string | null;
  joinedRecency: JoinedRecency | null;
}

export interface UseProfileEditorDraftResult {
  /** True until every read this hook needs has resolved at least once — nothing else below is meaningful before then. */
  loading: boolean;
  /** True once the draft has been seeded from the server. Until then nothing is editable (a failed first load shows `loadError` and `retry` instead). */
  ready: boolean;
  loadError: string | null;
  userId: string | null;
  firstName: string;
  /** The draft's graduating year (`profiles.grad_year` is the about section's year; one source of truth). */
  gradYear: number | null;
  /** `campus_slug.toUpperCase()` — the same derivation `me/root/useMeData.ts#identityLine` uses, kept identical so Me and the editor's Preview never disagree about the campus short name. */
  campusShort: string | null;
  verified: boolean;
  /** Live, not draft — photos aren't part of the draft model (uploads/reorders apply immediately, see `profile-editor/photos.tsx`). */
  photoCount: number;
  /** `tag_catalog()`: the interests offered to the caller, in display order. */
  catalog: Tag[];
  /** How many tags the caller holds on the server now; `set_my_tags` refuses a list shorter than `min(3, this)`. */
  savedTagCount: number;
  /** The fewest tags the picker's `done` accepts (mirrors `set_my_tags`). */
  minTags: number;
  draft: ProfileEditorDraft;
  /** Null until `my_profile_fields()` has loaded. */
  fieldsMeta: ProfileFieldsMeta | null;
  setStatusLine: (value: string) => void;
  setGoals: (value: UserGoal[]) => void;
  setTagIds: (value: string[]) => void;
  setPlaceLine: (value: string) => void;
  setUsualPlaces: (value: string[]) => void;
  setPrompts: (value: DraftPrompt[]) => void;
  setAbout: (value: AboutSection) => void;
  /**
   * Marks the place line to be sent again on `done` even though its text did
   * not change: saving restarts its two hours (brief: "saving the line again
   * refreshes it"), which is the only way back for a line that expired.
   */
  refreshPlaceLine: () => void;
  /** True once any of `draft`'s fields differs from the last-loaded/last-committed snapshot. */
  dirty: boolean;
  saving: boolean;
  saveError: string | null;
  /**
   * Why a field's last save was refused, by field (e.g. the word filter's
   * `that text can't be used.`), shown on that field's row and in its
   * editor. Cleared as soon as that field is edited again. The draft keeps
   * what was typed, so nothing is lost.
   */
  fieldErrors: Partial<Record<DraftField, string>>;
  /** Fires every changed field's write in parallel; commits (and invalidates the shared query keys) only the ones that succeed. Returns `true` iff every changed field saved. */
  commit: () => Promise<boolean>;
  /** Resets the draft back to the last-committed snapshot — `cancel`'s discard action. */
  discard: () => void;
  /** Refetches every read that failed — the load-error state's `try again`. */
  retry: () => void;
  /** Computed from the DRAFT status/goals/tags plus the live photo count — feeds both the Edit tab's per-section `+N%` labels and the Preview tab (so an unsaved edit updates its own completion picture immediately). */
  completion: ProfileCompletionResult;
}

function sameGoalSet(a: UserGoal[], b: UserGoal[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((value) => setB.has(value));
}

function sameOrderedIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, i) => value === b[i]);
}

function samePrompts(a: DraftPrompt[], b: DraftPrompt[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((prompt, i) => prompt.promptId === b[i].promptId && prompt.answer === b[i].answer);
}

/** Which draft fields differ from the committed snapshot. */
function changedFields(draft: ProfileEditorDraft, committed: ProfileEditorDraft): Set<DraftField> {
  const changed = new Set<DraftField>();
  if (draft.statusLine !== committed.statusLine) changed.add('statusLine');
  if (!sameGoalSet(draft.goals, committed.goals)) changed.add('goals');
  if (!sameOrderedIds(draft.tagIds, committed.tagIds)) changed.add('tagIds');
  if (draft.placeLine !== committed.placeLine) changed.add('placeLine');
  if (!sameOrderedIds(draft.usualPlaces, committed.usualPlaces)) changed.add('usualPlaces');
  if (!samePrompts(draft.prompts, committed.prompts)) changed.add('prompts');
  if (!sameAbout(committed.about, draft.about)) changed.add('about');
  return changed;
}

const EMPTY_DRAFT: ProfileEditorDraft = {
  statusLine: '',
  goals: [],
  tagIds: [],
  placeLine: '',
  usualPlaces: [],
  prompts: [],
  about: EMPTY_ABOUT,
};

/**
 * The profile editor's draft model (`docs/design/me-redesign/brief.md`,
 * "ProfileEditor — Edit tab"): status, goals, tags, the 0015 fields and the
 * 0018 about section are edited locally here and only reach the server on
 * `commit()` (the Edit tab's `done`), fired as one batch of parallel,
 * per-field writes — "all-or-report", not all-or-nothing: a field whose
 * write fails stays dirty (and in `draft`, so nothing the user typed is
 * lost) while every field that *did* save is folded into the new committed
 * snapshot, so a second `done` tap never resends what already succeeded.
 * Photos are deliberately NOT part of this draft — every photo change
 * applies immediately (see `profile-editor/photos.tsx`).
 *
 * Migration 0018: tags are interests only, written through `set_my_tags`
 * (the direct `user_tags` writes are revoked); the about section is written
 * through `set_my_about` as a patch of only what changed. Neither the 0015
 * fields nor about carry completion weight (the weights are a ruling); tags
 * count as done at 3 or more.
 */
export function useProfileEditorDraft(): UseProfileEditorDraftResult {
  const queryClient = useQueryClient();

  const meQuery = useQuery({ queryKey: queryKeys.me.result, queryFn: fetchMe });
  const firstNameQuery = useQuery({ queryKey: queryKeys.me.firstName, queryFn: getFirstName });
  const statusQuery = useQuery({ queryKey: queryKeys.me.status, queryFn: getStatusLine });
  const goalsQuery = useQuery({ queryKey: queryKeys.me.goals, queryFn: getUserGoals });
  const tagsQuery = useQuery({ queryKey: queryKeys.me.tags, queryFn: getUserTags });
  const photosQuery = useQuery({ queryKey: queryKeys.me.photos, queryFn: listMyPhotos });
  const fieldsQuery = useQuery({ queryKey: queryKeys.me.profileFields, queryFn: getMyProfileFields });
  const aboutQuery = useQuery({ queryKey: queryKeys.me.aboutSection, queryFn: getMyAbout });
  const catalogQuery = useQuery({ queryKey: queryKeys.tagCatalog, queryFn: listTagCatalog });

  const queries = [meQuery, firstNameQuery, statusQuery, goalsQuery, tagsQuery, photosQuery, fieldsQuery, aboutQuery, catalogQuery];
  const queriesLoaded = queries.every((query) => query.isSuccess);

  const [committed, setCommitted] = useState<ProfileEditorDraft | null>(null);
  const [draft, setDraft] = useState<ProfileEditorDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [placeRefresh, setPlaceRefresh] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<DraftField, string>>>({});

  // Seed the draft exactly once, the moment every read first resolves —
  // never again on a background refetch, which would silently clobber
  // whatever the user has already typed/picked.
  useEffect(() => {
    if (committed || !queriesLoaded) return;
    const snapshot: ProfileEditorDraft = {
      statusLine: statusQuery.data ?? '',
      goals: goalsQuery.data ?? [],
      tagIds: [...(tagsQuery.data ?? [])].sort((a, b) => a.position - b.position).map((t) => t.tag_id),
      placeLine: fieldsQuery.data?.placeLine ?? '',
      usualPlaces: fieldsQuery.data?.usualPlaces ?? [],
      prompts: (fieldsQuery.data?.prompts ?? []).map(({ promptId, question, gated, answer }) => ({
        promptId,
        question,
        gated,
        answer,
      })),
      about: aboutQuery.data ?? EMPTY_ABOUT,
    };
    setCommitted(snapshot);
    setDraft(snapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committed, queriesLoaded]);

  const loadError = queries.some((query) => query.isError) ? "that didn't load. try again." : null;

  const dirty = useMemo(() => {
    if (!committed) return false;
    return placeRefresh || changedFields(draft, committed).size > 0;
  }, [draft, committed, placeRefresh]);

  const completion = profileCompletion({
    photoCount: photosQuery.data?.length ?? 0,
    hasStatus: draft.statusLine.trim().length > 0,
    hasHereFor: draft.goals.length > 0,
    tagCount: draft.tagIds.length,
  });

  const savedTagCount = committed?.tagIds.length ?? 0;

  /** Sets one draft field and clears that field's last refusal. */
  function setField<K extends DraftField>(field: K, value: ProfileEditorDraft[K]) {
    setDraft((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  async function commit(): Promise<boolean> {
    if (!committed) return false;

    const changed = changedFields(draft, committed);
    if (placeRefresh && draft.placeLine.trim().length > 0) changed.add('placeLine');
    if (changed.size === 0) return true;

    setSaving(true);
    setSaveError(null);

    const jobs: { field: DraftField; run: () => Promise<unknown> }[] = [];
    if (changed.has('statusLine')) {
      const trimmed = draft.statusLine.trim();
      jobs.push({
        field: 'statusLine',
        run: () => updateProfile({ status_line: trimmed.length > 0 ? trimmed : null }),
      });
    }
    if (changed.has('goals')) {
      jobs.push({ field: 'goals', run: () => setUserGoals(draft.goals) });
    }
    if (changed.has('tagIds')) {
      jobs.push({ field: 'tagIds', run: () => setMyTags(draft.tagIds) });
    }
    // Migration 0015's fields: each write replaces the whole value. Saving
    // the place line (re)starts its two hours, so it is only sent when it
    // actually changed.
    if (changed.has('placeLine')) {
      const line = draft.placeLine.trim();
      jobs.push({ field: 'placeLine', run: () => setMyPlaceLine(line.length > 0 ? line : null) });
    }
    if (changed.has('usualPlaces')) {
      const places = draft.usualPlaces.map((place) => place.trim()).filter((place) => place.length > 0);
      jobs.push({ field: 'usualPlaces', run: () => setMyUsualPlaces(places) });
    }
    if (changed.has('prompts')) {
      const answers = draft.prompts.map(({ promptId, answer }) => ({ promptId, answer: answer.trim() }));
      jobs.push({ field: 'prompts', run: () => setMyPrompts(answers) });
    }
    // Migration 0018: a patch of only the about keys that changed.
    if (changed.has('about')) {
      const patch = aboutPatch(committed.about, draft.about);
      jobs.push({ field: 'about', run: () => setMyAbout(patch) });
    }

    const results = await Promise.allSettled(jobs.map((job) => job.run()));
    const anyFailed = results.some((result) => result.status === 'rejected');

    // Fold only the fields that actually saved into the new committed
    // snapshot — a failed field stays dirty (and stays in `draft`, so the
    // user's edit is never silently discarded) so a retry only resends what
    // didn't already succeed. A saved about section takes the server's
    // returned shape (it applies knock-on clears and carries the labels).
    setCommitted((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      jobs.forEach((job, i) => {
        const result = results[i];
        if (result.status !== 'fulfilled') return;
        if (job.field === 'about' && result.value) {
          next.about = result.value as AboutSection;
        } else {
          (next as Record<string, unknown>)[job.field] = draft[job.field];
        }
      });
      return next;
    });
    const savedAbout = jobs.findIndex((job) => job.field === 'about');
    if (savedAbout >= 0 && results[savedAbout].status === 'fulfilled') {
      const value = (results[savedAbout] as PromiseFulfilledResult<unknown>).value as AboutSection | undefined;
      if (value) setDraft((prev) => ({ ...prev, about: value }));
    }

    // Per-field refusals, shown on the field itself.
    const errors: Partial<Record<DraftField, string>> = {};
    jobs.forEach((job, i) => {
      const result = results[i];
      if (result.status === 'rejected') errors[job.field] = fieldErrorMessage(result.reason);
    });
    setFieldErrors(errors);

    // Invalidate whatever did save, even on a partial failure, so Me never
    // shows a stale value for a field that is already on the server.
    const saved = new Set(jobs.filter((_, i) => results[i].status === 'fulfilled').map((job) => job.field));
    if (saved.has('statusLine')) void queryClient.invalidateQueries({ queryKey: queryKeys.me.status });
    if (saved.has('goals')) void queryClient.invalidateQueries({ queryKey: queryKeys.me.goals });
    if (saved.has('tagIds')) void queryClient.invalidateQueries({ queryKey: queryKeys.me.tags });
    if (saved.has('placeLine')) setPlaceRefresh(false);
    if (saved.has('placeLine') || saved.has('usualPlaces') || saved.has('prompts')) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me.profileFields });
    }
    if (saved.has('about')) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me.aboutSection });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me.gradYear });
    }
    if (saved.size > 0) void queryClient.invalidateQueries({ queryKey: queryKeys.me.result });

    if (anyFailed) {
      // A field the server refused as bad input says why (`22023`, mapped
      // to the app's own copy); anything else is the generic line.
      const firstFailure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      setSaveError(fieldErrorMessage(firstFailure?.reason));
      setSaving(false);
      return false;
    }

    setSaving(false);
    return true;
  }

  function discard() {
    if (committed) setDraft(committed);
    setPlaceRefresh(false);
    setFieldErrors({});
  }

  function retry() {
    queries.filter((query) => query.isError).forEach((query) => void query.refetch());
  }

  return {
    // A failed read is not "still loading": the editor shows the error and a
    // retry instead of spinning forever.
    loading: !committed && !loadError,
    ready: !!committed,
    loadError,
    userId: meQuery.data?.id ?? null,
    firstName: firstNameQuery.data ?? '',
    gradYear: draft.about.graduatingYear,
    campusShort: meQuery.data?.campus_slug ? meQuery.data.campus_slug.toUpperCase() : null,
    verified: meQuery.data?.verification_status === 'verified',
    photoCount: photosQuery.data?.length ?? 0,
    catalog: catalogQuery.data ?? [],
    savedTagCount,
    minTags: minTagsToSave(savedTagCount),
    draft,
    fieldsMeta: fieldsQuery.data
      ? {
          savedPlaceLine: fieldsQuery.data.placeLine,
          placeLineUntil: fieldsQuery.data.placeLineUntil,
          placeLineShown: fieldsQuery.data.placeLineShown,
          joinedMonth: fieldsQuery.data.joinedMonth,
          joinedRecency: fieldsQuery.data.joinedRecency,
        }
      : null,
    setStatusLine: (value) => setField('statusLine', value),
    setGoals: (value) => setField('goals', value),
    setTagIds: (value) => setField('tagIds', value),
    setPlaceLine: (value) => setField('placeLine', value),
    setUsualPlaces: (value) => setField('usualPlaces', value),
    setPrompts: (value) => setField('prompts', value),
    setAbout: (value) => setField('about', value),
    refreshPlaceLine: () => setPlaceRefresh(true),
    dirty,
    saving,
    saveError,
    fieldErrors,
    commit,
    discard,
    retry,
    completion,
  };
}
