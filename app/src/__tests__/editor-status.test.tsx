import { fireEvent, render } from '@testing-library/react-native';
import { STATUS_MAX_LENGTH, STATUS_SUGGESTIONS, StatusEditor } from '../me/editor/StatusEditor';

/**
 * `StatusEditor` is the ONE component `EditStatus`/`QuickStatus` both
 * render (`docs/design/me-redesign/brief.md`) — this suite covers the
 * shared field/counter/suggestions/clear behaviour directly against the
 * component, independent of either route wrapper's own navigation/
 * persistence (covered separately: `profile-editor/status.tsx` writes into
 * the draft and pops, `quick-status.tsx` saves immediately — see
 * `editor-screen.test.tsx` and the quick-status suite).
 */
describe('StatusEditor', () => {
  it('opens with the initial value and a matching counter', async () => {
    const { findByTestId } = await render(
      <StatusEditor initialValue="hello there" onCancel={jest.fn()} onSave={jest.fn()} />
    );
    const input = await findByTestId('status-editor-input');
    expect(input.props.value).toBe('hello there');
    const counter = await findByTestId('status-editor-counter');
    expect(counter.props.children).toEqual(`${'hello there'.length} / ${STATUS_MAX_LENGTH}`);
  });

  it('the field enforces the 140-character cap via maxLength', async () => {
    const { findByTestId } = await render(<StatusEditor initialValue="" onCancel={jest.fn()} onSave={jest.fn()} />);
    const input = await findByTestId('status-editor-input');
    expect(input.props.maxLength).toBe(140);
    expect(STATUS_MAX_LENGTH).toBe(140);
  });

  it('the counter updates live as the field changes', async () => {
    const { findByTestId } = await render(<StatusEditor initialValue="" onCancel={jest.fn()} onSave={jest.fn()} />);
    const input = await findByTestId('status-editor-input');
    await fireEvent.changeText(input, 'at the gym');
    const counter = await findByTestId('status-editor-counter');
    expect(counter.props.children).toBe(`10 / ${STATUS_MAX_LENGTH}`);
  });

  it('"clear" empties the field', async () => {
    const { findByTestId } = await render(
      <StatusEditor initialValue="something" onCancel={jest.fn()} onSave={jest.fn()} />
    );
    await fireEvent.press(await findByTestId('status-editor-clear'));
    const input = await findByTestId('status-editor-input');
    expect(input.props.value).toBe('');
  });

  it('renders all four suggestions, and tapping one REPLACES the field contents', async () => {
    const { findByTestId } = await render(
      <StatusEditor initialValue="whatever was here before" onCancel={jest.fn()} onSave={jest.fn()} />
    );
    for (let i = 0; i < STATUS_SUGGESTIONS.length; i++) {
      await findByTestId(`status-editor-suggestion-${i}`);
    }

    await fireEvent.press(await findByTestId('status-editor-suggestion-2'));
    const input = await findByTestId('status-editor-input');
    expect(input.props.value).toBe(STATUS_SUGGESTIONS[2]);
  });

  it('"cancel" fires onCancel without saving', async () => {
    const onCancel = jest.fn();
    const onSave = jest.fn();
    const { findByTestId } = await render(<StatusEditor initialValue="x" onCancel={onCancel} onSave={onSave} />);
    await fireEvent.press(await findByTestId('status-editor-cancel'));
    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('"save" fires onSave with the trimmed field value', async () => {
    const onSave = jest.fn();
    const { findByTestId } = await render(<StatusEditor initialValue="" onCancel={jest.fn()} onSave={onSave} />);
    const input = await findByTestId('status-editor-input');
    await fireEvent.changeText(input, '  padded on both sides  ');
    await fireEvent.press(await findByTestId('status-editor-save'));
    expect(onSave).toHaveBeenCalledWith('padded on both sides');
  });

  it('disables cancel/save while saving', async () => {
    const { findByTestId } = await render(
      <StatusEditor initialValue="x" saving onCancel={jest.fn()} onSave={jest.fn()} />
    );
    expect((await findByTestId('status-editor-cancel')).props.accessibilityState?.disabled).toBe(true);
    expect((await findByTestId('status-editor-save')).props.accessibilityState?.disabled).toBe(true);
  });

  it('shows an error message when given one', async () => {
    const { findByTestId } = await render(
      <StatusEditor initialValue="x" error="that didn't work." onCancel={jest.fn()} onSave={jest.fn()} />
    );
    const error = await findByTestId('status-editor-error');
    expect(error.props.children).toBe("that didn't work.");
  });
});
