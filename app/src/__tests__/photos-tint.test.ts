import { tintForPhoto } from '../photos/tint';
import { colors } from '../theme/tokens';

describe('tintForPhoto (deterministic hash fallback onto the curated avatarTints palette — see module doc for why)', () => {
  it('is deterministic: the same user + position always returns the same tint', () => {
    const first = tintForPhoto('11111111-1111-1111-1111-111111111111', 0);
    const second = tintForPhoto('11111111-1111-1111-1111-111111111111', 0);
    expect(first).toBe(second);
  });

  it('always returns one of the nine curated colors.avatarTints values (product-owner ruling on deviation 6)', () => {
    expect(colors.avatarTints).toContain(tintForPhoto('11111111-1111-1111-1111-111111111111', 0));
    for (let i = 0; i < 25; i++) {
      expect(colors.avatarTints).toContain(tintForPhoto(`user-${i}`, i % 3));
    }
  });

  it('varies across a user\'s 3 photo slots, so they do not all render identically', () => {
    const userId = '11111111-1111-1111-1111-111111111111';
    const tints = new Set([tintForPhoto(userId, 0), tintForPhoto(userId, 1), tintForPhoto(userId, 2)]);
    expect(tints.size).toBe(3);
  });

  it('varies across users for the same position (not a constant color)', () => {
    const a = tintForPhoto('11111111-1111-1111-1111-111111111111', 0);
    const b = tintForPhoto('22222222-2222-2222-2222-222222222222', 0);
    expect(a).not.toBe(b);
  });
});
