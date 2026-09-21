const mockGetSession = jest.fn();
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
    auth: { getSession: (...args: unknown[]) => mockGetSession(...args) },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import { dismissHi, hiBack, listReceivedHis, sendHi } from '../api/his';

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
