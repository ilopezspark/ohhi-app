import { render, fireEvent } from '@testing-library/react-native';
import { ChipPicker } from '../settings/ChipPicker';
import { IDENTITY_FIELD_SPECS, isSingleField, normalizeTypedEntry } from '../profile/fields';
import {
  CARD_CHIPS,
  CARD_CHIP_MAX_LENGTH,
  CARD_MAX_ITEMS,
  CHIP_MAX_LENGTH,
  IDENTITY_FIELDS,
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

  it('caps: orientation <= 3 and a typed pronoun <= 16 (payload v2, reconcile C6); the v1 card screens keep 8 items of <= 40 chars', () => {
    expect(ORIENTATION_MAX_ITEMS).toBe(3);
    expect(PRONOUN_MAX_LENGTH).toBe(16);
    expect(CARD_MAX_ITEMS).toBe(8);
    expect(CARD_CHIP_MAX_LENGTH).toBe(40);
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

  // kinks is the one fixed list long enough (10) to exercise the 8-item cap;
  // the design's into list has four entries.
  it('card field: selecting a 9th chip at the 8-item cap is a no-op', async () => {
    const eightSelected = CARD_CHIPS.kinks.slice(0, 8);
    const ninthOption = CARD_CHIPS.kinks[8];
    const onChange = jest.fn();
    const { getByTestId } = await render(
      <ChipPicker
        testID="card-kinks"
        options={CARD_CHIPS.kinks}
        selected={eightSelected}
        maxItems={CARD_MAX_ITEMS}
        onChange={onChange}
      />
    );

    await fireEvent.press(getByTestId(`card-kinks-${ninthOption}`));

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

/**
 * Payload v2 (profile restructure, phase 4c): the public-card editors take
 * single vs multi, the total cap and the "write your own" allowance from
 * `IDENTITY_FIELD_SPECS`, so the specs themselves must hold together.
 */
describe('public-card field specs (payload v2)', () => {
  it('single fields are exactly the non-multiple specs, and every option fits a chip', () => {
    for (const field of IDENTITY_FIELDS) {
      const spec = IDENTITY_FIELD_SPECS[field];
      expect({ field, single: isSingleField(field) }).toEqual({ field, single: !spec.multiple });
      for (const option of spec.options) expect(option.length).toBeLessThanOrEqual(CHIP_MAX_LENGTH);
    }
  });

  it('write your own only on pronouns (16), orientation (24) and languages (24), each within its total cap', () => {
    const typed = IDENTITY_FIELDS.filter((field) => {
      const spec = IDENTITY_FIELD_SPECS[field];
      return spec.multiple && spec.typed !== null;
    });
    expect(typed).toEqual(['pronouns', 'orientation', 'languages']);
    for (const field of typed) {
      const spec = IDENTITY_FIELD_SPECS[field];
      if (!spec.multiple || !spec.typed) continue;
      expect(spec.maxItems === null || spec.typed.maxCount <= spec.maxItems).toBe(true);
    }
    expect(IDENTITY_FIELD_SPECS.pronouns.multiple && IDENTITY_FIELD_SPECS.pronouns.typed?.maxLength).toBe(16);
    expect(IDENTITY_FIELD_SPECS.orientation.multiple && IDENTITY_FIELD_SPECS.orientation.typed?.maxLength).toBe(24);
    expect(IDENTITY_FIELD_SPECS.languages.multiple && IDENTITY_FIELD_SPECS.languages.typed?.maxLength).toBe(24);
  });

  it('normalizeTypedEntry refuses what the editor refuses before sending', () => {
    const spec = IDENTITY_FIELD_SPECS.pronouns;
    expect(normalizeTypedEntry('  ey/em ', spec, [])).toMatchObject({ ok: true, value: 'ey/em', listed: false });
    expect(normalizeTypedEntry('He/Him', spec, [])).toMatchObject({ ok: true, value: 'he/him', listed: true });
    expect(normalizeTypedEntry('x'.repeat(17), spec, [])).toMatchObject({ ok: false, rejection: 'too_long' });
    expect(normalizeTypedEntry('ze/zir', spec, ['ey/em'])).toMatchObject({ ok: false, rejection: 'too_many' });
    expect(normalizeTypedEntry('men', IDENTITY_FIELD_SPECS.interested_in, [])).toMatchObject({ ok: true, listed: true });
    expect(normalizeTypedEntry('robots', IDENTITY_FIELD_SPECS.interested_in, [])).toMatchObject({ ok: false, rejection: 'not_listed' });
  });
});
