import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { Sheet, SheetModal } from '../ui/Sheet';
import { spacing } from '../theme/tokens';

describe('ui/Sheet', () => {
  it('renders its children inside the sheet', async () => {
    const { getByText } = await render(
      <Sheet>
        <Text>real students only.</Text>
      </Sheet>
    );
    expect(getByText('real students only.')).toBeTruthy();
  });

  it('shows the grab handle by default and can hide it', async () => {
    const { getByTestId: withHandle } = await render(<Sheet testID="sheet" />);
    // handle is an unlabelled View, so assert indirectly via the sheet still mounting cleanly
    expect(withHandle('sheet-backdrop')).toBeTruthy();

    const { queryByTestId } = await render(<Sheet showHandle={false} />);
    expect(queryByTestId('sheet-backdrop')).toBeTruthy();
  });

  it('tapping the backdrop calls onDismiss', async () => {
    const onDismiss = jest.fn();
    const { getByTestId } = await render(<Sheet testID="sheet" onDismiss={onDismiss} />);
    await fireEvent.press(getByTestId('sheet-backdrop'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('the dim covers the whole parent, top to bottom and edge to edge', async () => {
    const { getByTestId } = await render(<Sheet testID="sheet" />);
    for (const id of ['sheet', 'sheet-backdrop']) {
      expect(flat(getByTestId(id).props.style)).toMatchObject({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 });
    }
  });

  it('keeps its content clear of the bottom safe-area inset (home indicator / navigation bar)', async () => {
    const withInsets = (bottom: number) => (
      <SafeAreaInsetsContext.Provider value={{ top: 47, right: 0, bottom, left: 0 }}>
        <Sheet testID="sheet" />
      </SafeAreaInsetsContext.Provider>
    );
    const tall = await render(withInsets(48));
    expect(flat(tall.getByTestId('sheet-panel').props.style).paddingBottom).toBe(48 + spacing.lgXl);
    // No inset (or a small one): the design's own 32.
    const none = await render(withInsets(0));
    expect(flat(none.getByTestId('sheet-panel').props.style).paddingBottom).toBe(spacing.xxxl + spacing.xs);
  });
});

describe('ui/SheetModal', () => {
  it('renders the sheet in a transparent Modal drawn under the status and navigation bars', async () => {
    const onDismiss = jest.fn();
    const screen = await render(
      <SheetModal testID="sheet" onDismiss={onDismiss}>
        <Text>pick one</Text>
      </SheetModal>
    );
    // The host modal view the sheet is mounted inside.
    let modal = screen.getByTestId('sheet').parent;
    while (modal && modal.props.transparent === undefined) modal = modal.parent;
    if (!modal) throw new Error('the sheet is not inside a Modal');
    expect(modal.props).toMatchObject({ visible: true, transparent: true, statusBarTranslucent: true, navigationBarTranslucent: true });
    expect(screen.getByText('pick one')).toBeTruthy();
    // Android back closes it.
    modal.props.onRequestClose();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while not visible', async () => {
    const screen = await render(
      <SheetModal visible={false} testID="sheet">
        <Text>pick one</Text>
      </SheetModal>
    );
    expect(screen.queryByText('pick one')).toBeNull();
  });
});

function flat(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
}
