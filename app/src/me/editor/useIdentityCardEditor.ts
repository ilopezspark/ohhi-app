import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { putIdentity } from '../../api/identityWrite';
import { fieldErrorMessage, isWordFilterError, WORD_FILTER_COPY, type Audience, type IdentityCard, type IdentityField, type IdentityPatch } from '../../profile/fields';
import { myIdentityQuery } from '../card/summary';
import {
  buildCardPatch,
  cardDraftFrom,
  fieldsWithNewTypedEntries,
  isDraftDirty,
  withFieldValue,
  type CardDraft,
} from './identityCardDraft';
import { useDiscardGuard } from './useDiscardGuard';

/**
 * The owner preview's read of the cards (`app/profile-preview.tsx`,
 * `MY_IDENTITY_CARDS_KEY`), repeated here rather than imported so a hook does
 * not pull in a route module. Invalidated on save so the preview is current.
 */
export const PREVIEW_IDENTITY_KEY = ['me', 'identity_cards'] as const;

export interface IdentityCardEditor {
  card: IdentityCard;
  /** True until the owner's cards have loaded once. */
  loading: boolean;
  /** The first read failed: show `retry`. */
  loadFailed: boolean;
  retry: () => void;
  draft: CardDraft | null;
  setValue: (field: IdentityField, next: string | null | string[]) => void;
  setAudience: (audience: Audience) => void;
  dirty: boolean;
  saving: boolean;
  /** A failed save that is not the word filter's (that one sits on its field: `fieldErrors`). */
  saveError: string | null;
  /** The word filter's line on the fields whose typed entries were just added. Cleared once that field changes. */
  fieldErrors: Partial<Record<IdentityField, string>>;
  save: () => void;
  /** Back: leaves straight away when nothing changed, else asks first. */
  requestClose: () => void;
}

/**
 * One public card's editor (identity, background, lifestyle, when i'm
 * around, before you message me). Unlike status or the 0015 fields these do
 * not ride the editor's shared draft (`ProfileEditorDraftContext`): they live
 * in the encrypted identity payload, behind a different write
 * (`PUT /identity`), so each screen saves on its own, the way the old
 * pronouns and orientation screen and the private card do, and uses the same
 * unsaved-changes guard as the pushed field screens (`useDiscardGuard`).
 *
 * The save sends a partial patch of this card only (`buildCardPatch`), then
 * refreshes the owner's cards (the section list's counts), any open
 * profile read (`['identity', id]`) and the preview's own read.
 */
export function useIdentityCardEditor(card: IdentityCard): IdentityCardEditor {
  const queryClient = useQueryClient();
  const query = useQuery(myIdentityQuery);
  const [initial, setInitial] = useState<CardDraft | null>(null);
  const [draft, setDraft] = useState<CardDraft | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<IdentityField, string>>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  // Seed once, from the first data there is. A later refetch never replaces
  // what is being edited, and the patch carries only what changed here.
  useEffect(() => {
    if (!query.data || initial) return;
    const seeded = cardDraftFrom(query.data, card);
    setInitial(seeded);
    setDraft(seeded);
  }, [query.data, initial, card]);

  const dirty = !!initial && !!draft && isDraftDirty(card, initial, draft);
  const guard = useDiscardGuard(dirty);

  const mutation = useMutation({
    mutationFn: (patch: IdentityPatch) => putIdentity(patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: myIdentityQuery.queryKey });
      void queryClient.invalidateQueries({ queryKey: ['identity'] });
      void queryClient.invalidateQueries({ queryKey: PREVIEW_IDENTITY_KEY });
      guard.leave();
    },
    onError: (error) => {
      if (isWordFilterError(error) && initial && draft) {
        const fields = fieldsWithNewTypedEntries(card, initial, draft);
        if (fields.length > 0) {
          setFieldErrors(Object.fromEntries(fields.map((field) => [field, WORD_FILTER_COPY])));
          return;
        }
      }
      setSaveError(fieldErrorMessage(error));
    },
  });

  function setValue(field: IdentityField, next: string | null | string[]) {
    setDraft((prev) => (prev ? { ...prev, values: withFieldValue(prev.values, field, next) } : prev));
    setFieldErrors((prev) => {
      if (!(field in prev)) return prev;
      const rest = { ...prev };
      delete rest[field];
      return rest;
    });
    setSaveError(null);
  }

  function setAudience(audience: Audience) {
    setDraft((prev) => (prev ? { ...prev, audience } : prev));
    setSaveError(null);
  }

  function save() {
    if (!initial || !draft || mutation.isPending) return;
    const patch = buildCardPatch(card, initial, draft);
    if (!patch) {
      guard.leave();
      return;
    }
    setSaveError(null);
    setFieldErrors({});
    mutation.mutate(patch);
  }

  return {
    card,
    loading: !initial && query.isPending,
    loadFailed: !initial && query.isError,
    retry: () => void query.refetch(),
    draft,
    setValue,
    setAudience,
    dirty,
    saving: mutation.isPending,
    saveError,
    fieldErrors,
    save,
    requestClose: guard.requestClose,
  };
}
