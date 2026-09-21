import { render, fireEvent } from '@testing-library/react-native';
import { ChipPicker } from '../settings/ChipPicker';
import {
  CARD_CHIPS,
  CARD_CHIP_MAX_LENGTH,
  CARD_MAX_ITEMS,
  ORIENTATION_CHIPS,
  ORIENTATION_CHIP_MAX_LENGTH,
  ORIENTATION_MAX_ITEMS,
  PRONOUN_MAX_LENGTH,
} from '../settings/vocab';

/**
 * Decision 21/20 limits, enforced two ways: (1) the vocab constants
 * themselves are internally consistent (every chip fits its own max
 * length), and (2) `ChipPicker` — the shared control both the identity and
 * card editors use — actually stops selecting past `maxItems`.
 */

describe('vocab limits (decision 20/21)', () => {
  it('every orientation chip is within ORIENTATION_CHIP_MAX_LENGTH', () => {
    for (const chip of ORIENTATION_CHIPS) {
      expect(chip.length).toBeLessThanOrEqual(ORIENTATION_CHIP_MAX_LENGTH);
    }
  });

  it('every card chip, for every field, is within CARD_CHIP_MAX_LENGTH', () => {
    for (const field of Object.keys(CARD_CHIPS) as (keyof typeof CARD_CHIPS)[]) {
      for (const chip of CARD_CHIPS[field]) {
        expect(chip.length).toBeLessThanOrEqual(CARD_CHIP_MAX_LENGTH);
      }
    }
  });

  it('caps match decision 20/21 exactly: orientation <= 3, card fields <= 8 items of <= 40 chars', () => {
    expect(ORIENTATION_MAX_ITEMS).toBe(3);
    expect(CARD_MAX_ITEMS).toBe(8);
    expect(CARD_CHIP_MAX_LENGTH).toBe(40);
    expect(PRONOUN_MAX_LENGTH).toBe(40);
  });
});

describe('ChipPicker enforces maxItems', () => {
  it('orientation: selecting a 4th chip when 3 are already selected is a no-op', async () => {
    const onChange = jest.fn();
    const { getByTestId } = await render(
      <ChipPicker
        testID="orientation"
        options={ORIENTATION_CHIPS}
        selected={['gay', 'bi', 'pan']}
        maxItems={ORIENTATION_MAX_ITEMS}
        onChange={onChange}
      />
    );

    await fireEvent.press(getByTestId('orientation-queer'));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('orientation: deselecting one of the 3 already-selected chips still works at the cap', async () => {
    const onChange = jest.fn();
    const { getByTestId } = await render(
      <ChipPicker
        testID="orientation"
        options={ORIENTATION_CHIPS}
        selected={['gay', 'bi', 'pan']}
        maxItems={ORIENTATION_MAX_ITEMS}
        onChange={onChange}
      />
    );

    await fireEvent.press(getByTestId('orientation-gay'));

    expect(onChange).toHaveBeenCalledWith(['bi', 'pan']);
  });

  it('card field: selecting a 9th chip at the 8-item cap is a no-op', async () => {
    const eightSelected = CARD_CHIPS.into.slice(0, 8);
    const ninthOption = CARD_CHIPS.into[8];
    const onChange = jest.fn();
    const { getByTestId } = await render(
      <ChipPicker
        testID="card-into"
        options={CARD_CHIPS.into}
        selected={eightSelected}
        maxItems={CARD_MAX_ITEMS}
        onChange={onChange}
      />
    );

    await fireEvent.press(getByTestId(`card-into-${ninthOption}`));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('adds a chip under the cap', async () => {
    const onChange = jest.fn();
    const { getByTestId } = await render(
      <ChipPicker testID="card-kinks" options={CARD_CHIPS.kinks} selected={[]} maxItems={CARD_MAX_ITEMS} onChange={onChange} />
    );

    await fireEvent.press(getByTestId(`card-kinks-${CARD_CHIPS.kinks[0]}`));

    expect(onChange).toHaveBeenCalledWith([CARD_CHIPS.kinks[0]]);
  });
});
