import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
}));
jest.mock('../api/identityWrite', () => ({ getMyCard: jest.fn(), putCard: jest.fn() }));

import { router } from 'expo-router';
import { getMyCard, putCard } from '../api/identityWrite';
import EditPrivateCardScreen from '../app/profile-editor/private-card';
import { CARD_CHIPS, CARD_MAX_ITEMS } from '../settings/vocab';

const EMPTY_CARD = { into: [], safer_sex: [], kinks: [], hard_nos: [] };

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EditPrivateCardScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('EditPrivateCardScreen', () => {
  it('loads the current card and renders every group, hard nos last', async () => {
    (getMyCard as jest.Mock).mockResolvedValue(EMPTY_CARD);
    const { findByTestId } = await renderScreen();
    await findByTestId('private-card-editor-into');
    await findByTestId('private-card-editor-safer_sex');
    await findByTestId('private-card-editor-kinks');
    await findByTestId('private-card-editor-hard_nos');
  });

  describe('typed hard nos ("+ add your own")', () => {
    it('adds a trimmed, whitespace-collapsed typed entry as a removable chip', async () => {
      (getMyCard as jest.Mock).mockResolvedValue(EMPTY_CARD);
      const { findByTestId } = await renderScreen();
      await fireEvent.press(await findByTestId('private-card-editor-hard-nos-add'));
      const input = await findByTestId('private-card-editor-hard-nos-input-input');
      await fireEvent.changeText(input, '  no   early mornings  ');
      await fireEvent.press(await findByTestId('private-card-editor-hard-nos-confirm'));
      await findByTestId('private-card-editor-hard_nos-no early mornings');
    });

    it('rejects an entry over 40 characters with the length copy', async () => {
      (getMyCard as jest.Mock).mockResolvedValue(EMPTY_CARD);
      const { findByTestId } = await renderScreen();
      await fireEvent.press(await findByTestId('private-card-editor-hard-nos-add'));
      const input = await findByTestId('private-card-editor-hard-nos-input-input');
      await fireEvent.changeText(input, 'x'.repeat(41));
      await fireEvent.press(await findByTestId('private-card-editor-hard-nos-confirm'));
      const error = await findByTestId('private-card-editor-hard-nos-error');
      expect(error.props.children).toEqual(expect.stringContaining('40 characters'));
    });

    it('rejects a case-insensitive duplicate of a fixed suggestion', async () => {
      (getMyCard as jest.Mock).mockResolvedValue({ ...EMPTY_CARD, hard_nos: ['no substances'] });
      const { findByTestId } = await renderScreen();
      await fireEvent.press(await findByTestId('private-card-editor-hard-nos-add'));
      const input = await findByTestId('private-card-editor-hard-nos-input-input');
      await fireEvent.changeText(input, 'NO SUBSTANCES');
      await fireEvent.press(await findByTestId('private-card-editor-hard-nos-confirm'));
      await findByTestId('private-card-editor-hard-nos-error');
    });

    it('hides "+ add your own" once the group has 8 items', async () => {
      const eightHardNos = Array.from({ length: CARD_MAX_ITEMS }, (_, i) => `custom no ${i}`);
      (getMyCard as jest.Mock).mockResolvedValue({ ...EMPTY_CARD, hard_nos: eightHardNos });
      const { findByTestId, queryByTestId } = await renderScreen();
      await findByTestId('private-card-editor-hard_nos');
      expect(queryByTestId('private-card-editor-hard-nos-add')).toBeNull();
    });
  });

  describe('the "tested" safer-sex chip', () => {
    it('produces the "tested <mon> \'<yy>" pattern from the month/year picker', async () => {
      (getMyCard as jest.Mock).mockResolvedValue(EMPTY_CARD);
      (putCard as jest.Mock).mockResolvedValue({ user_id: 'u1', key_version: 1, fields_filled: 1, updated_at: 'now' });
      const { findByTestId } = await renderScreen();
      await fireEvent.press(await findByTestId('private-card-editor-tested'));
      await findByTestId('private-card-editor-tested-sheet');
      await fireEvent.press(await findByTestId('private-card-editor-tested-month-apr'));
      await fireEvent.press(await findByTestId('private-card-editor-tested-year-26'));
      await fireEvent.press(await findByTestId('private-card-editor-tested-confirm'));

      const testedChip = await findByTestId('private-card-editor-tested');
      expect(testedChip.props.accessibilityLabel).toBe("tested apr '26");
      expect(testedChip.props.accessibilityState?.checked).toBe(true);

      await fireEvent.press(await findByTestId('private-card-editor-done'));
      await waitFor(() =>
        expect(putCard).toHaveBeenCalledWith(
          expect.objectContaining({ safer_sex: ["tested apr '26"] })
        )
      );
    });
  });

  it('sends the full four-key payload on done, including every group untouched', async () => {
    (getMyCard as jest.Mock).mockResolvedValue({ into: ['men'], safer_sex: [], kinks: [], hard_nos: [] });
    (putCard as jest.Mock).mockResolvedValue({ user_id: 'u1', key_version: 1, fields_filled: 1, updated_at: 'now' });
    const { findByTestId } = await renderScreen();
    await fireEvent.press(await findByTestId(`private-card-editor-kinks-${CARD_CHIPS.kinks[0]}`));
    await fireEvent.press(await findByTestId('private-card-editor-done'));

    await waitFor(() =>
      expect(putCard).toHaveBeenCalledWith({
        into: ['men'],
        safer_sex: [],
        kinks: [CARD_CHIPS.kinks[0]],
        hard_nos: [],
      })
    );
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  describe('cancel / dirty-dismiss', () => {
    it('goes back immediately with no confirmation when nothing changed', async () => {
      (getMyCard as jest.Mock).mockResolvedValue(EMPTY_CARD);
      const { findByTestId } = await renderScreen();
      await fireEvent.press(await findByTestId('private-card-editor-cancel'));
      expect(Alert.alert).not.toHaveBeenCalled();
      expect(router.back).toHaveBeenCalled();
    });

    it('confirms before discarding when the card was edited', async () => {
      (getMyCard as jest.Mock).mockResolvedValue(EMPTY_CARD);
      const { findByTestId } = await renderScreen();
      await fireEvent.press(await findByTestId(`private-card-editor-into-${CARD_CHIPS.into[0]}`));
      await fireEvent.press(await findByTestId('private-card-editor-cancel'));

      expect(Alert.alert).toHaveBeenCalled();
      expect(router.back).not.toHaveBeenCalled();
    });

    it('navigates back once the discard action is chosen', async () => {
      (getMyCard as jest.Mock).mockResolvedValue(EMPTY_CARD);
      (Alert.alert as jest.Mock).mockImplementation((_title, _msg, buttons) => {
        const discard = buttons?.find((b: { text: string }) => b.text === 'discard');
        discard?.onPress?.();
      });
      const { findByTestId } = await renderScreen();
      await fireEvent.press(await findByTestId(`private-card-editor-into-${CARD_CHIPS.into[0]}`));
      await fireEvent.press(await findByTestId('private-card-editor-cancel'));
      expect(router.back).toHaveBeenCalled();
    });
  });

  it('shows the generic refusal copy when the save fails', async () => {
    (getMyCard as jest.Mock).mockResolvedValue(EMPTY_CARD);
    (putCard as jest.Mock).mockRejectedValue(new Error("That didn't work."));
    const { findByTestId } = await renderScreen();
    await fireEvent.press(await findByTestId('private-card-editor-done'));
    await findByTestId('private-card-editor-error');
    expect(router.back).not.toHaveBeenCalled();
  });
});
