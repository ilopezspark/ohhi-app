import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { me as fetchMe } from '../../api/me';
import { getFirstName, getGradYear, getStatusLine, updateProfile } from '../../api/profile';
import { getUserGoals, setUserGoals, type UserGoal } from '../../api/goals';
import { getUserTags, setUserTags, listTagsForCampus, type Tag } from '../../api/tags';
import { listMyPhotos } from '../../api/photos';
import { profileCompletion, type ProfileCompletionResult } from '../../profile/completion';
import { queryKeys } from '../queryKeys';

export type { UserGoal, Tag };

export interface ProfileEditorDraft {
  statusLine: string;
  goals: UserGoal[];
  tagIds: string[];
}

export interface UseProfileEditorDraftResult {
  /** True until every read this hook needs has resolved at least once — nothing else below is meaningful before then. */
  loading: boolean;
  /** True once the draft has been seeded from the server. Until then nothing is editable (a failed first load shows `loadError` and `retry` instead). */
  ready: boolean;
  loadError: string | null;
  userId: string | null;
  firstName: string;
  gradYear: number | null;
  /** `campus_slug.toUpperCase()` — the same derivation `me/root/useMeData.ts#identityLine` uses, kept identical so Me and the editor's Preview never disagree about the campus short name. */
  campusShort: string | null;
  verified: boolean;
  /** Live, not draft — photos aren't part of the draft model (uploads/reorders apply immediately, see `profile-editor/photos.tsx`). */
  photoCount: number;
  /** The campus's tag options (global + the caller's campus) for the tag picker sheet. */
  campusTags: Tag[];
  draft: ProfileEditorDraft;
  setStatusLine: (value: string) => void;
  setGoals: (value: UserGoal[]) => void;
  setTagIds: (value: string[]) => void;
  /** True once any of `draft`'s three fields differs from the last-loaded/last-committed snapshot. */
  dirty: boolean;
  saving: boolean;
  saveError: string | null;
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

/**
 * The profile editor's draft model (`docs/design/me-redesign/brief.md`,
 * "ProfileEditor — Edit tab"): status, goals and tags are edited locally
 * here and only reach the server on `commit()` (the Edit tab's `done`),
 * fired as one batch of parallel, per-field writes — "all-or-report", not
 * all-or-nothing: a field whose write fails stays dirty (and in `draft`, so
 * nothing the user typed is lost) while every field that *did* save is
 * folded into the new committed snapshot, so a second `done` tap never
 * resends what already succeeded. Photos are deliberately NOT part of this
 * draft — every photo change applies immediately, because uploads route
 * through moderation regardless of when the editor is dismissed (see
 * `profile-editor/photos.tsx`).
 */
export function useProfileEditorDraft(): UseProfileEditorDraftResult {
  const queryClient = useQueryClient();

  const meQuery = useQuery({ queryKey: queryKeys.me.result, queryFn: fetchMe });
  const firstNameQuery = useQuery({ queryKey: queryKeys.me.firstName, queryFn: getFirstName });
  const gradYearQuery = useQuery({ queryKey: queryKeys.me.gradYear, queryFn: getGradYear });
  const statusQuery = useQuery({ queryKey: queryKeys.me.status, queryFn: getStatusLine });
  const goalsQuery = useQuery({ queryKey: queryKeys.me.goals, queryFn: getUserGoals });
  const tagsQuery = useQuery({ queryKey: queryKeys.me.tags, queryFn: getUserTags });
  const photosQuery = useQuery({ queryKey: queryKeys.me.photos, queryFn: listMyPhotos });

  const campusId = meQuery.data?.campus_id ?? null;
  const campusTagsQuery = useQuery({
    queryKey: ['me.editor.campusTags', campusId],
    queryFn: () => listTagsForCampus(campusId),
    enabled: meQuery.isSuccess,
  });

  const queriesLoaded =
    meQuery.isSuccess &&
    firstNameQuery.isSuccess &&
    gradYearQuery.isSuccess &&
    statusQuery.isSuccess &&
    goalsQuery.isSuccess &&
    tagsQuery.isSuccess &&
    photosQuery.isSuccess &&
    campusTagsQuery.isSuccess;

  const [committed, setCommitted] = useState<ProfileEditorDraft | null>(null);
  const [draft, setDraft] = useState<ProfileEditorDraft>({ statusLine: '', goals: [], tagIds: [] });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Seed the draft exactly once, the moment every read first resolves —
  // never again on a background refetch, which would silently clobber
  // whatever the user has already typed/picked.
  useEffect(() => {
    if (committed || !queriesLoaded) return;
    const snapshot: ProfileEditorDraft = {
      statusLine: statusQuery.data ?? '',
      goals: goalsQuery.data ?? [],
      tagIds: [...(tagsQuery.data ?? [])].sort((a, b) => a.position - b.position).map((t) => t.tag_id),
    };
    setCommitted(snapshot);
    setDraft(snapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committed, queriesLoaded]);

  const loadError =
    meQuery.isError ||
    firstNameQuery.isError ||
    gradYearQuery.isError ||
    statusQuery.isError ||
    goalsQuery.isError ||
    tagsQuery.isError ||
    photosQuery.isError ||
    campusTagsQuery.isError
      ? "that didn't load. try again."
      : null;

  const dirty = useMemo(() => {
    if (!committed) return false;
    return (
      draft.statusLine !== committed.statusLine ||
      !sameGoalSet(draft.goals, committed.goals) ||
      !sameOrderedIds(draft.tagIds, committed.tagIds)
    );
  }, [draft, committed]);

  const completion = profileCompletion({
    photoCount: photosQuery.data?.length ?? 0,
    hasStatus: draft.statusLine.trim().length > 0,
    hasHereFor: draft.goals.length > 0,
    hasTags: draft.tagIds.length > 0,
  });

  async function commit(): Promise<boolean> {
    if (!committed) return false;

    const statusChanged = draft.statusLine !== committed.statusLine;
    const goalsChanged = !sameGoalSet(draft.goals, committed.goals);
    const tagsChanged = !sameOrderedIds(draft.tagIds, committed.tagIds);

    if (!statusChanged && !goalsChanged && !tagsChanged) return true;

    setSaving(true);
    setSaveError(null);

    const jobs: { field: keyof ProfileEditorDraft; run: () => Promise<void> }[] = [];
    if (statusChanged) {
      const trimmed = draft.statusLine.trim();
      jobs.push({
        field: 'statusLine',
        run: () => updateProfile({ status_line: trimmed.length > 0 ? trimmed : null }),
      });
    }
    if (goalsChanged) {
      jobs.push({ field: 'goals', run: () => setUserGoals(draft.goals) });
    }
    if (tagsChanged) {
      jobs.push({ field: 'tagIds', run: () => setUserTags(draft.tagIds) });
    }

    const results = await Promise.allSettled(jobs.map((job) => job.run()));
    const anyFailed = results.some((result) => result.status === 'rejected');

    // Fold only the fields that actually saved into the new committed
    // snapshot — a failed field stays dirty (and stays in `draft`, so the
    // user's edit is never silently discarded) so a retry only resends what
    // didn't already succeed.
    setCommitted((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      jobs.forEach((job, i) => {
        if (results[i].status === 'fulfilled') {
          (next as Record<string, unknown>)[job.field] = draft[job.field];
        }
      });
      return next;
    });

    // Invalidate whatever did save, even on a partial failure, so Me never
    // shows a stale value for a field that is already on the server. Tags
    // also feed Me's identity line (the major tag), hence `majorLabel`.
    const saved = new Set(jobs.filter((_, i) => results[i].status === 'fulfilled').map((job) => job.field));
    if (saved.has('statusLine')) void queryClient.invalidateQueries({ queryKey: queryKeys.me.status });
    if (saved.has('goals')) void queryClient.invalidateQueries({ queryKey: queryKeys.me.goals });
    if (saved.has('tagIds')) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me.tags });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me.majorLabel });
    }
    if (saved.size > 0) void queryClient.invalidateQueries({ queryKey: queryKeys.me.result });

    if (anyFailed) {
      setSaveError("that didn't work.");
      setSaving(false);
      return false;
    }

    setSaving(false);
    return true;
  }

  function discard() {
    if (committed) setDraft(committed);
  }

  function retry() {
    const all = [meQuery, firstNameQuery, gradYearQuery, statusQuery, goalsQuery, tagsQuery, photosQuery, campusTagsQuery];
    all.filter((query) => query.isError).forEach((query) => void query.refetch());
  }

  return {
    // A failed read is not "still loading": the editor shows the error and a
    // retry instead of spinning forever.
    loading: !committed && !loadError,
    ready: !!committed,
    loadError,
    userId: meQuery.data?.id ?? null,
    firstName: firstNameQuery.data ?? '',
    gradYear: gradYearQuery.data ?? null,
    campusShort: meQuery.data?.campus_slug ? meQuery.data.campus_slug.toUpperCase() : null,
    verified: meQuery.data?.verification_status === 'verified',
    photoCount: photosQuery.data?.length ?? 0,
    campusTags: campusTagsQuery.data ?? [],
    draft,
    setStatusLine: (value) => setDraft((prev) => ({ ...prev, statusLine: value })),
    setGoals: (value) => setDraft((prev) => ({ ...prev, goals: value })),
    setTagIds: (value) => setDraft((prev) => ({ ...prev, tagIds: value })),
    dirty,
    saving,
    saveError,
    commit,
    discard,
    retry,
    completion,
  };
}
