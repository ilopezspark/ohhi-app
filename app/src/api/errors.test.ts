import { mapSupabaseError, RefusedError, UnknownError } from './errors';

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
