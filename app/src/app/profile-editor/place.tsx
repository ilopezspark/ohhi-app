import { useState } from 'react';
import { FieldEditorFrame } from '../../me/editor/FieldEditorFrame';
import { PlaceLineField, placeLineStatus } from '../../me/editor/PlaceLineField';
import { useProfileEditorDraftContext } from '../../me/editor/ProfileEditorDraftContext';
import { useDiscardGuard } from '../../me/editor/useDiscardGuard';

/**
 * `/profile-editor/place` (`docs/design/profile-redesign/brief.md`, ruling 4):
 * the place line, a few self-typed words about where you are right now,
 * shown on the hero in place of the tier word. Draft-model like the status
 * line: `save` writes into the editor's draft and pops, the editor's `done`
 * sends it. Saving the same line again marks it to be re-sent, since that
 * is what restarts its two hours.
 */
export default function EditPlaceScreen() {
  const draftState = useProfileEditorDraftContext();
  const initial = draftState.draft.placeLine;
  const [value, setValue] = useState(initial);
  const guard = useDiscardGuard(value !== initial);
  const meta = draftState.fieldsMeta;

  const status = meta
    ? placeLineStatus({
        value,
        savedPlaceLine: meta.savedPlaceLine,
        placeLineUntil: meta.placeLineUntil,
        placeLineShown: meta.placeLineShown,
      })
    : null;

  function save() {
    const next = value.trim();
    if (next.length > 0 && next === initial.trim()) draftState.refreshPlaceLine();
    else draftState.setPlaceLine(next);
    guard.leave();
  }

  return (
    <FieldEditorFrame
      testID="editor-place"
      title="where you are"
      intro="a few words about where you are right now, for example library, 2nd floor."
      onCancel={guard.requestClose}
      onSave={save}
    >
      <PlaceLineField testID="editor-place-field" value={value} onChange={setValue} status={status} autoFocus />
    </FieldEditorFrame>
  );
}
