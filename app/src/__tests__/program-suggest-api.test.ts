const mockRpc = jest.fn();

jest.mock('../api/client', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

import { ProgramSuggestionError, suggestProgram, PROGRAM_SUGGESTION_COPY } from '../api/about';
import { InvalidInputError, RefusedError, UnknownError } from '../api/errors';

beforeEach(() => jest.clearAllMocks());

describe('suggestProgram (suggest_program)', () => {
  it('sends the trimmed label and the kind', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await suggestProgram('  marine biology ', 'major');
    expect(mockRpc).toHaveBeenCalledWith('suggest_program', { p_label: 'marine biology', p_kind: 'major' });
    await suggestProgram('spanish', 'minor');
    expect(mockRpc).toHaveBeenLastCalledWith('suggest_program', { p_label: 'spanish', p_kind: 'minor' });
  });

  it('mirrors the 1-60 length rule before sending', async () => {
    for (const label of ['', '   ', 'x'.repeat(61)]) {
      const error = await suggestProgram(label, 'major').catch((e) => e);
      expect(error).toBeInstanceOf(ProgramSuggestionError);
      expect(error.reason).toBe('length');
    }
    expect(mockRpc).not.toHaveBeenCalled();
    mockRpc.mockResolvedValue({ data: null, error: null });
    await suggestProgram('x'.repeat(60), 'major');
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["that text can't be used", 'filtered', "that text can't be used."],
    ['that one is already on the list', 'listed', 'that one is already on the list.'],
    ['too many suggestions waiting', 'waiting', 'you have a few suggestions waiting already.'],
    ['a suggestion must be 1-60 characters', 'length', 'keep it between 1 and 60 characters.'],
    ["a suggestion can't be blank", 'length', 'keep it between 1 and 60 characters.'],
    ['p_kind must be major or minor', 'other', "that didn't work."],
  ])('maps 22023 %p to its own refusal and copy, never the server text', async (message, reason, copy) => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '22023', message } });
    const error = await suggestProgram('marine biology', 'major').catch((e) => e);
    expect(error).toBeInstanceOf(ProgramSuggestionError);
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.reason).toBe(reason);
    expect(error.message).toBe(copy);
    expect(PROGRAM_SUGGESTION_COPY[reason as keyof typeof PROGRAM_SUGGESTION_COPY]).toBe(copy);
  });

  it('not signed in is the usual refusal; a missing function (before the migration) is unknown', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'not allowed' } });
    expect(await suggestProgram('marine biology', 'major').catch((e) => e)).toBeInstanceOf(RefusedError);
    mockRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.suggest_program' } });
    expect(await suggestProgram('marine biology', 'major').catch((e) => e)).toBeInstanceOf(UnknownError);
  });

  it('every refusal line follows the voice rules (lowercase, no exclamation points)', () => {
    for (const line of Object.values(PROGRAM_SUGGESTION_COPY)) {
      expect(line).toBe(line.toLowerCase());
      expect(line).not.toContain('!');
    }
  });
});
