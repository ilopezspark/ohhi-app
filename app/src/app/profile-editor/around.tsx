import { View } from 'react-native';
import { IDENTITY_CARD_LABELS } from '../../me/card/fieldLabels';
import {
  CARD_EDITOR_TITLE_SIZE,
  CardEditorSaveButton,
  cardEditorStyles,
  IdentityCardFields,
} from '../../me/editor/IdentityCardEditor';
import { useIdentityCardEditor } from '../../me/editor/useIdentityCardEditor';
import { KeyboardScrollView, ScreenHeader } from '../../ui';

const TEST_ID = 'editor-card-around';

/**
 * `/profile-editor/around`: the "when i'm around" public card's editor
 * (`docs/design/profile-restructure/reconcile.md` phase 4c): when i'm free and communication.
 * Saves on its own through `PUT /identity`, a partial patch of this card only
 * (`me/editor/useIdentityCardEditor.ts`). No completion weight (C8).
 */
export default function AroundEditorScreen() {
  const editor = useIdentityCardEditor('around');
  return (
    <View style={cardEditorStyles.screen} testID={TEST_ID}>
      <ScreenHeader
        title={IDENTITY_CARD_LABELS.around}
        titleSize={CARD_EDITOR_TITLE_SIZE}
        onBack={editor.requestClose}
        backTestID={`${TEST_ID}-back`}
      />
      <KeyboardScrollView
        contentContainerStyle={cardEditorStyles.body}
        footer={<CardEditorSaveButton editor={editor} testID={`${TEST_ID}-save`} />}
        footerStyle={cardEditorStyles.footer}
      >
        <IdentityCardFields editor={editor} testID={TEST_ID} />
      </KeyboardScrollView>
    </View>
  );
}
