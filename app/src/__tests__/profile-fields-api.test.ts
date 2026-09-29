const mockRpc = jest.fn();
const mockOrder = jest.fn();
const mockEq = jest.fn((..._args: unknown[]) => ({ order: mockOrder }));
const mockSelect = jest.fn((..._args: unknown[]) => ({ eq: mockEq }));
const mockFrom = jest.fn((..._args: unknown[]) => ({ select: mockSelect }));

jest.mock('../api/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import {
  getMyProfileFields,
  listActivePrompts,
  setMyPlaceLine,
  setMyPrompts,
  setMyUsualPlaces,
} from '../api/profileFields';
import { InvalidInputError, RefusedError, UnknownError } from '../api/errors';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getMyProfileFields', () => {
  it('calls my_profile_fields and maps the row, prompts sorted by position', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          place_line: 'library, 2nd floor',
          place_line_until: '2026-09-29T20:00:00Z',
          place_line_shown: true,
          usual_places: ['library', 'the gym'],
          prompts: [
            { position: 1, prompt_id: 'b', question: 'q b', gated: true, answer: 'b' },
            { position: 0, prompt_id: 'a', question: 'q a', gated: false, answer: 'a' },
          ],
          joined_month: '2026-09-01',
          joined_recency: 'yesterday',
        },
      ],
      error: null,
    });

    const fields = await getMyProfileFields();

    expect(mockRpc).toHaveBeenCalledWith('my_profile_fields');
    expect(fields).toEqual({
      placeLine: 'library, 2nd floor',
      placeLineUntil: '2026-09-29T20:00:00Z',
      placeLineShown: true,
      usualPlaces: ['library', 'the gym'],
      prompts: [
        { position: 0, promptId: 'a', question: 'q a', gated: false, answer: 'a' },
        { position: 1, promptId: 'b', question: 'q b', gated: true, answer: 'b' },
      ],
      joinedMonth: '2026-09-01',
      joinedRecency: 'yesterday',
    });
  });

  it('reads no row (not signed in) as nothing set', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const fields = await getMyProfileFields();
    expect(fields.placeLine).toBeNull();
    expect(fields.usualPlaces).toEqual([]);
    expect(fields.prompts).toEqual([]);
    expect(fields.placeLineShown).toBe(false);
  });

  it('maps nulls from the row', async () => {
    mockRpc.mockResolvedValue({
      data: [{ place_line: null, place_line_until: null, place_line_shown: false, usual_places: [], prompts: [], joined_month: null, joined_recency: null }],
      error: null,
    });
    const fields = await getMyProfileFields();
    expect(fields).toMatchObject({ placeLine: null, placeLineUntil: null, joinedMonth: null, joinedRecency: null });
  });

  it('throws the generic refusal for 42501', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'not allowed' } });
    await expect(getMyProfileFields()).rejects.toBeInstanceOf(RefusedError);
  });
});

describe('listActivePrompts', () => {
  it('reads the shared prompt list: active only, in sort_order', async () => {
    const rows = [
      { id: 'ruining_my_life', question: "the class that's ruining my life right now", gated: false, sort_order: 1 },
      { id: 'find_me_on_campus', question: "you'll find me on campus at", gated: true, sort_order: 2 },
    ];
    mockOrder.mockResolvedValue({ data: rows, error: null });

    const result = await listActivePrompts();

    expect(mockFrom).toHaveBeenCalledWith('prompts');
    expect(mockSelect).toHaveBeenCalledWith('id, question, gated, sort_order');
    expect(mockEq).toHaveBeenCalledWith('active', true);
    expect(mockOrder).toHaveBeenCalledWith('sort_order', { ascending: true });
    expect(result).toEqual(rows);
  });
});

describe('the three writes (whole-value replace, through RPCs only)', () => {
  it('set_my_place_line sends the line and returns place_line_until', async () => {
    mockRpc.mockResolvedValue({ data: '2026-09-29T20:00:00Z', error: null });
    await expect(setMyPlaceLine('library, 2nd floor')).resolves.toBe('2026-09-29T20:00:00Z');
    expect(mockRpc).toHaveBeenCalledWith('set_my_place_line', { p_line: 'library, 2nd floor' });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('set_my_place_line with null clears (a blank line) and returns null', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(setMyPlaceLine(null)).resolves.toBeNull();
    expect(mockRpc).toHaveBeenCalledWith('set_my_place_line', { p_line: '' });
  });

  it('set_my_usual_places sends the list and returns the stored one', async () => {
    mockRpc.mockResolvedValue({ data: ['library'], error: null });
    await expect(setMyUsualPlaces(['library'])).resolves.toEqual(['library']);
    expect(mockRpc).toHaveBeenCalledWith('set_my_usual_places', { p_places: ['library'] });
  });

  it('set_my_prompts sends [{prompt_id, answer}] in order and parses the stored answers', async () => {
    mockRpc.mockResolvedValue({
      data: [{ position: 0, prompt_id: 'a', question: 'q', gated: false, answer: 'x' }],
      error: null,
    });
    const stored = await setMyPrompts([
      { promptId: 'a', answer: 'x' },
      { promptId: 'b', answer: 'y' },
    ]);
    expect(mockRpc).toHaveBeenCalledWith('set_my_prompts', {
      p_prompts: [
        { prompt_id: 'a', answer: 'x' },
        { prompt_id: 'b', answer: 'y' },
      ],
    });
    expect(stored).toEqual([{ position: 0, promptId: 'a', question: 'q', gated: false, answer: 'x' }]);
  });

  it.each([
    ['set_my_place_line', () => setMyPlaceLine('x'), 'place line must be 40 characters or fewer', 'keep it to 40 characters.'],
    ['set_my_usual_places', () => setMyUsualPlaces(['a', 'A']), 'usual places must not repeat', 'that place is already on your list.'],
    ['set_my_usual_places', () => setMyUsualPlaces(['a', 'b', 'c', 'd']), 'at most 3 usual places', '3 places at most.'],
    ['set_my_prompts', () => setMyPrompts([{ promptId: 'x', answer: 'y' }]), 'unknown prompt', "one of those prompts isn't available anymore. pick another one."],
    ['set_my_prompts', () => setMyPrompts([{ promptId: 'x', answer: 'y' }]), 'each answer must be 1-140 characters', 'each answer needs 1 to 140 characters.'],
    ['set_my_prompts', () => setMyPrompts([{ promptId: 'x', answer: 'y' }]), 'prompts must be a list', "that didn't work."],
  ])('%s maps 22023 "%s" to lowercase copy', async (_rpc, call, serverMessage, copy) => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '22023', message: serverMessage } });
    const error = await (call as () => Promise<unknown>)().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidInputError);
    expect((error as Error).message).toBe(copy);
  });

  it('keeps 42501 the generic refusal and anything else unknown', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'not allowed' } });
    await expect(setMyUsualPlaces([])).rejects.toBeInstanceOf(RefusedError);
    mockRpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } });
    await expect(setMyPrompts([])).rejects.toBeInstanceOf(UnknownError);
  });
});
