import { router } from 'expo-router';
import { StatusEditor } from '../../me/editor/StatusEditor';
import { useProfileEditorDraftContext } from '../../me/editor/ProfileEditorDraftContext';

/**
 * `EditStatus` (`docs/design/me-redesign/brief.md`) — the profile-editor
 * presentation of the shared `StatusEditor`: `save` writes into the draft
 * (not the server — status is draft-model, committed together with goals/
 * tags on the Edit tab's own `done`) and pops back to the editor.
 */
export default function EditStatusScreen() {
  const draftState = useProfileEditorDraftContext();

  return (
    <StatusEditor
      testID="editor-status-editor"
      initialValue={draftState.draft.statusLine}
      onCancel={() => router.back()}
      onSave={(value) => {
        draftState.setStatusLine(value);
        router.back();
      }}
    />
  );
}
