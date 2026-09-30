import { useState } from 'react';
import { TagPicker } from '../../tags/TagPicker';
import { useProfileEditorDraftContext } from '../../me/editor/ProfileEditorDraftContext';
import { useDiscardGuard } from '../../me/editor/useDiscardGuard';

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/**
 * `/profile-editor/tags`: the full-screen interest picker (migration 0018,
 * `docs/design/tags-about/brief.md` §1), pushed from the edit tab's
 * `interests` card. Draft-model like the other pushed editors: `done · N of
 * 10` writes the picks into the editor's draft and pops; the editor's own
 * `done` sends them through `set_my_tags`.
 *
 * The minimum mirrors the server: someone holding 3 or more cannot go under
 * 3; someone the 0018 migration left with 0-2 may keep, swap or add (the
 * picker still asks for three).
 */
export default function EditTagsScreen() {
  const draftState = useProfileEditorDraftContext();
  const initial = draftState.draft.tagIds;
  const [selected, setSelected] = useState<string[]>(initial);
  const guard = useDiscardGuard(!sameOrder(selected, initial));

  return (
    <TagPicker
      testID="editor-tags-picker"
      title="interests"
      intro="up to 10, in the order you want them shown"
      closeLabel="cancel"
      onClose={guard.requestClose}
      catalog={draftState.catalog}
      selected={selected}
      onChange={setSelected}
      min={draftState.minTags}
      minNote="pick at least three."
      verb="done"
      onSubmit={() => {
        draftState.setTagIds(selected);
        guard.leave();
      }}
    />
  );
}
