import { GoneError, isUnavailableError, mapSupabaseError, RefusedError, UnknownError } from './errors';

describe('mapSupabaseError', () => {
  it('maps a Postgres 42501 code to RefusedError', () => {
    expect(mapSupabaseError({ code: '42501', message: 'permission denied for table hi' })).toBeInstanceOf(
      RefusedError
    );
  });

  it('maps a literal "not allowed" message to RefusedError', () => {
    expect(mapSupabaseError({ message: 'not allowed' })).toBeInstanceOf(RefusedError);
  });

  it('never leaks why the call was refused', () => {
    const error = mapSupabaseError({ code: '42501' });
    const lowered = error.message.toLowerCase();
    expect(lowered).not.toContain('block');
    expect(lowered).not.toContain('denied');
    expect(lowered).not.toContain('forbidden');
  });

  it('maps any other Postgres error to a generic UnknownError', () => {
    expect(mapSupabaseError({ code: '23505', message: 'duplicate key value' })).toBeInstanceOf(UnknownError);
  });

  it('maps a plain network/unexpected error to UnknownError', () => {
    expect(mapSupabaseError(new Error('network request failed'))).toBeInstanceOf(UnknownError);
    expect(mapSupabaseError(undefined)).toBeInstanceOf(UnknownError);
  });
});

describe('mapSupabaseError — gone (migration 0014, decision 90)', () => {
  it('maps "conversation not found" and "hi not found" to GoneError, with neutral lowercase copy', () => {
    for (const message of ['conversation not found', 'hi not found']) {
      const error = mapSupabaseError({ code: 'P0001', message });
      expect(error).toBeInstanceOf(GoneError);
      expect(error.message).toBe("this isn't available anymore.");
    }
  });

  it('never says why something is gone', () => {
    const lowered = new GoneError().message.toLowerCase();
    for (const word of ['banned', 'suspended', 'deleted', 'blocked', 'not found']) {
      expect(lowered).not.toContain(word);
    }
  });

  it('keeps an error that is already mapped, instead of demoting a refusal to "something went wrong"', () => {
    const refused = new RefusedError();
    const gone = new GoneError();
    const unknown = new UnknownError('x');
    expect(mapSupabaseError(refused)).toBe(refused);
    expect(mapSupabaseError(gone)).toBe(gone);
    expect(mapSupabaseError(unknown)).toBe(unknown);
  });

  it('isUnavailableError is true for a refusal or gone, and false for anything else', () => {
    expect(isUnavailableError(new RefusedError())).toBe(true);
    expect(isUnavailableError(new GoneError())).toBe(true);
    expect(isUnavailableError(new UnknownError())).toBe(false);
    expect(isUnavailableError(new Error('not allowed'))).toBe(false);
  });
});
