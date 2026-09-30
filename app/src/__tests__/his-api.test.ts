const mockGetSession = jest.fn();
const mockGetUser = jest.fn();
const mockRpc = jest.fn();

const mockInsert = jest.fn();
const mockOrder = jest.fn();
const mockEqSelect2 = jest.fn((..._args: unknown[]) => ({ order: mockOrder }));
const mockEqSelect1 = jest.fn((..._args: unknown[]) => ({ eq: mockEqSelect2 }));
const mockSelect = jest.fn((..._args: unknown[]) => ({ eq: mockEqSelect1 }));
const mockEqUpdate = jest.fn();
const mockUpdate = jest.fn((..._args: unknown[]) => ({ eq: mockEqUpdate }));
const mockFrom = jest.fn((..._args: unknown[]) => ({ insert: mockInsert, select: mockSelect, update: mockUpdate }));

jest.mock('../api/client', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      getUser: (...args: unknown[]) => mockGetUser(...args),
    },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import { dismissHi, hiBack, HIS_SENT_QUERY_KEY, listReceivedHis, listSentHis, sendHi } from '../api/his';
import { queryClient } from '../query/client';

const ME = '11111111-1111-4111-8111-111111111111';
const SENDER = '22222222-2222-4222-8222-222222222222';
const HI_ID = 'hi-1';

describe('sendHi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: ME } } }, error: null });
    mockInsert.mockResolvedValue({ error: null });
  });

  it('inserts exactly { from_user_id, to_user_id } — never state', async () => {
    await sendHi(SENDER);

    expect(mockFrom).toHaveBeenCalledWith('his');
    expect(mockInsert).toHaveBeenCalledWith({ from_user_id: ME, to_user_id: SENDER });
    const payload = mockInsert.mock.calls[0][0];
    expect(payload).not.toHaveProperty('state');
  });

  it('refreshes the sent list once the hi is in', async () => {
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);

    await sendHi(SENDER);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: HIS_SENT_QUERY_KEY });
    invalidate.mockRestore();
  });

  it('does not refresh the sent list when the insert is refused', async () => {
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    mockInsert.mockResolvedValue({ error: { code: '42501', message: 'not allowed' } });

    await expect(sendHi(SENDER)).rejects.toThrow();

    expect(invalidate).not.toHaveBeenCalled();
    invalidate.mockRestore();
  });

  it('throws the mapped error without inserting when there is no session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(sendHi(SENDER)).rejects.toThrow();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('throws the generic refused error on a 42501 (block/refusal) insert failure', async () => {
    mockInsert.mockResolvedValue({ error: { code: '42501', message: 'not allowed' } });

    await expect(sendHi(SENDER)).rejects.toThrow("That didn't work.");
  });
});

describe('listReceivedHis', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: ME } } }, error: null });
  });

  it('selects to_user_id = me, state = sent, newest first, joined to the sender', async () => {
    mockOrder.mockResolvedValue({
      data: [
        {
          id: HI_ID,
          created_at: '2026-09-20T10:00:00Z',
          expires_at: '2026-09-27T10:00:00Z',
          from_user_id: SENDER,
          sender: { first_name: 'Ada', user_photos: [{ storage_path: `${SENDER}/0.jpg`, position: 0 }] },
        },
      ],
      error: null,
    });

    const result = await listReceivedHis();

    expect(mockFrom).toHaveBeenCalledWith('his');
    expect(mockEqSelect1).toHaveBeenCalledWith('to_user_id', ME);
    expect(mockEqSelect2).toHaveBeenCalledWith('state', 'sent');
    expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(result).toEqual([
      {
        id: HI_ID,
        createdAt: '2026-09-20T10:00:00Z',
        expiresAt: '2026-09-27T10:00:00Z',
        fromUserId: SENDER,
        firstName: 'Ada',
        photoPath: `${SENDER}/0.jpg`,
      },
    ]);
  });

  it('degrades to null name/photo when the sender row does not resolve, rather than failing the row', async () => {
    mockOrder.mockResolvedValue({
      data: [
        { id: HI_ID, created_at: 'now', expires_at: null, from_user_id: SENDER, sender: null },
      ],
      error: null,
    });

    const result = await listReceivedHis();

    expect(result).toEqual([
      { id: HI_ID, createdAt: 'now', expiresAt: null, fromUserId: SENDER, firstName: null, photoPath: null },
    ]);
  });

  it('picks the position-0 photo when the sender has more than one ok photo', async () => {
    mockOrder.mockResolvedValue({
      data: [
        {
          id: HI_ID,
          created_at: 'now',
          expires_at: null,
          from_user_id: SENDER,
          sender: {
            first_name: 'Ada',
            user_photos: [
              { storage_path: `${SENDER}/1.jpg`, position: 1 },
              { storage_path: `${SENDER}/0.jpg`, position: 0 },
            ],
          },
        },
      ],
      error: null,
    });

    const result = await listReceivedHis();

    expect(result[0].photoPath).toBe(`${SENDER}/0.jpg`);
  });
});

describe('listSentHis', () => {
  const RECIPIENT = '33333333-3333-4333-8333-333333333333';

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: ME } }, error: null });
  });

  it('selects from_user_id = me, state = sent, newest first, joined to the recipient', async () => {
    mockOrder.mockResolvedValue({
      data: [
        {
          id: HI_ID,
          created_at: '2026-09-20T10:00:00Z',
          expires_at: '2026-09-27T10:00:00Z',
          to_user_id: RECIPIENT,
          recipient: { first_name: 'Cy', user_photos: [{ storage_path: `${RECIPIENT}/0.jpg`, position: 0 }] },
        },
      ],
      error: null,
    });

    const result = await listSentHis();

    expect(mockFrom).toHaveBeenCalledWith('his');
    expect(mockSelect.mock.calls[0][0]).toContain('his_to_user_id_fkey');
    expect(mockEqSelect1).toHaveBeenCalledWith('from_user_id', ME);
    expect(mockEqSelect2).toHaveBeenCalledWith('state', 'sent');
    expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(result).toEqual([
      {
        id: HI_ID,
        createdAt: '2026-09-20T10:00:00Z',
        expiresAt: '2026-09-27T10:00:00Z',
        toUserId: RECIPIENT,
        firstName: 'Cy',
        photoPath: `${RECIPIENT}/0.jpg`,
      },
    ]);
  });

  it('degrades to null name/photo when the recipient row does not resolve', async () => {
    mockOrder.mockResolvedValue({
      data: [{ id: HI_ID, created_at: 'now', expires_at: null, to_user_id: RECIPIENT, recipient: null }],
      error: null,
    });

    const result = await listSentHis();

    expect(result).toEqual([
      { id: HI_ID, createdAt: 'now', expiresAt: null, toUserId: RECIPIENT, firstName: null, photoPath: null },
    ]);
  });

  it('picks the position-0 photo and unwraps an array-shaped recipient', async () => {
    mockOrder.mockResolvedValue({
      data: [
        {
          id: HI_ID,
          created_at: 'now',
          expires_at: null,
          to_user_id: RECIPIENT,
          recipient: [
            {
              first_name: 'Cy',
              user_photos: [
                { storage_path: `${RECIPIENT}/1.jpg`, position: 1 },
                { storage_path: `${RECIPIENT}/0.jpg`, position: 0 },
              ],
            },
          ],
        },
      ],
      error: null,
    });

    const result = await listSentHis();

    expect(result[0].firstName).toBe('Cy');
    expect(result[0].photoPath).toBe(`${RECIPIENT}/0.jpg`);
  });

  it('throws when nobody is signed in, without querying', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(listSentHis()).rejects.toThrow('Not signed in.');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('throws the mapped error when the read fails', async () => {
    mockOrder.mockResolvedValue({ data: null, error: { code: '42501', message: 'not allowed' } });

    await expect(listSentHis()).rejects.toThrow("That didn't work.");
  });
});

describe('dismissHi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEqUpdate.mockResolvedValue({ error: null });
  });

  it('updates only { state: "dismissed" }, filtered by id', async () => {
    await dismissHi(HI_ID);

    expect(mockFrom).toHaveBeenCalledWith('his');
    expect(mockUpdate).toHaveBeenCalledWith({ state: 'dismissed' });
    const payload = mockUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['state']);
    expect(mockEqUpdate).toHaveBeenCalledWith('id', HI_ID);
  });

  it('throws the mapped error when the guard/policy refuses the update', async () => {
    mockEqUpdate.mockResolvedValue({ error: { code: '42501', message: 'not allowed' } });

    await expect(dismissHi(HI_ID)).rejects.toThrow("That didn't work.");
  });
});

describe('hiBack', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls hi_back(p_hi_id) and returns the conversation id', async () => {
    mockRpc.mockResolvedValue({ data: 'conv-1', error: null });

    const result = await hiBack(HI_ID);

    expect(mockRpc).toHaveBeenCalledWith('hi_back', { p_hi_id: HI_ID });
    expect(result).toBe('conv-1');
  });

  it('throws the mapped error when the RPC refuses', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'not allowed' } });

    await expect(hiBack(HI_ID)).rejects.toThrow("That didn't work.");
  });
});
