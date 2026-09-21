const mockGetUser = jest.fn();
const mockInsert = jest.fn();
const mockFrom = jest.fn((..._args: unknown[]) => ({ insert: mockInsert }));

jest.mock('../api/client', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import { submitReport } from '../api/reports';

const ME = '11111111-1111-4111-8111-111111111111';
const SUBJECT = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: ME } } });
  mockInsert.mockResolvedValue({ error: null });
});

describe('submitReport', () => {
  it('sends exactly the six allowed columns — never state/severity/resolved_at/action_taken', async () => {
    await submitReport({
      subjectId: SUBJECT,
      category: 'harassment',
      note: 'they kept messaging after I said no',
      contextType: 'chat',
      contextId: 'conversation-1',
    });

    expect(mockFrom).toHaveBeenCalledWith('reports');
    const payload = mockInsert.mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual(
      ['category', 'context_id', 'context_type', 'note', 'reporter_id', 'subject_id'].sort()
    );
    expect(payload).not.toHaveProperty('state');
    expect(payload).not.toHaveProperty('severity');
    expect(payload).not.toHaveProperty('resolved_at');
    expect(payload).not.toHaveProperty('action_taken');
    expect(payload).toEqual({
      reporter_id: ME,
      subject_id: SUBJECT,
      category: 'harassment',
      note: 'they kept messaging after I said no',
      context_type: 'chat',
      context_id: 'conversation-1',
    });
  });

  it('sends note as null rather than an empty string when blank', async () => {
    await submitReport({ subjectId: SUBJECT, category: 'other', note: '   ', contextType: 'profile', contextId: null });

    const payload = mockInsert.mock.calls[0][0];
    expect(payload.note).toBeNull();
  });

  it('never includes a severity control value regardless of category', async () => {
    for (const category of ['fake_profile', 'harassment', 'threat', 'spam', 'photos_not_them', 'minor', 'other'] as const) {
      mockInsert.mockClear();
      await submitReport({ subjectId: SUBJECT, category, note: null, contextType: 'profile', contextId: null });
      expect(mockInsert.mock.calls[0][0]).not.toHaveProperty('severity');
    }
  });

  it('maps a 42501 (is_active gate failure) to the generic refused error', async () => {
    mockInsert.mockResolvedValue({ error: { code: '42501', message: 'not allowed' } });
    await expect(
      submitReport({ subjectId: SUBJECT, category: 'other', note: null, contextType: 'profile', contextId: null })
    ).rejects.toThrow("That didn't work.");
  });
});
