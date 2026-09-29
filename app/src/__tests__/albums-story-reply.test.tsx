/**
 * The story's reply bar rules (`albums/storyReply.ts`) and hook
 * (`albums/useStoryReply.ts`): who gets a bar, which conversation it
 * writes to (given from a thread, looked up from the albums list), the
 * plain-text send, and refusals that stay neutral.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

jest.mock('../api/client', () => ({ supabase: {}, SUPABASE_URL: 'https://example.test' }));
jest.mock('../api/conversations', () => ({ getConversation: jest.fn() }));
jest.mock('../api/messages', () => ({ sendMessage: jest.fn() }));
jest.mock('../api/albumOwner', () => ({ findConversationIdWith: jest.fn() }));

import { getConversation, type ConversationDetail } from '../api/conversations';
import { sendMessage } from '../api/messages';
import { findConversationIdWith } from '../api/albumOwner';
import { GoneError, RefusedError } from '../api/errors';
import { replyRules } from '../albums/storyReply';
import { useStoryReply } from '../albums/useStoryReply';

const ME = 'me-id';
const OWNER = 'owner-id';
const CONV = 'conv-id';

function conversation(overrides: Partial<ConversationDetail> = {}): ConversationDetail {
  return {
    id: CONV,
    state: 'open',
    openedById: OWNER,
    blockedBy: null,
    userAId: OWNER,
    userBId: ME,
    lastMessageAt: '2026-09-29T09:00:00Z',
    createdAt: '2026-09-28T09:00:00Z',
    other: { id: OWNER, firstName: 'maya', photoPath: null },
    lastMessage: null,
    lastReadAt: null,
    ...overrides,
  };
}

describe('replyRules', () => {
  it('an open thread between the two of them: yes, with the ordinary cap', () => {
    expect(replyRules(conversation(), ME, OWNER)).toEqual({ canReply: true, maxLength: 1000 });
  });

  it('never for the owner on their own album', () => {
    expect(replyRules(conversation(), OWNER, OWNER).canReply).toBe(false);
  });

  it('never without a conversation, or in one that is not exactly the two of them', () => {
    expect(replyRules(null, ME, OWNER).canReply).toBe(false);
    expect(replyRules(conversation({ userAId: 'someone-else' }), ME, OWNER).canReply).toBe(false);
  });

  it('follows the composer: closed, expired and waiting threads get no bar', () => {
    expect(replyRules(conversation({ state: 'expired' }), ME, OWNER).canReply).toBe(false);
    expect(replyRules(conversation({ state: 'closed_block', blockedBy: ME }), ME, OWNER).canReply).toBe(false);
    // I opened it and already spoke: waiting for a reply.
    expect(
      replyRules(
        conversation({
          state: 'awaiting_reply',
          openedById: ME,
          lastMessage: { sender_id: ME } as ConversationDetail['lastMessage'],
        }),
        ME,
        OWNER
      ).canReply
    ).toBe(false);
  });

  it('the blocked side keeps the bar, like its composer (decision 12)', () => {
    expect(replyRules(conversation({ state: 'closed_block', blockedBy: OWNER }), ME, OWNER).canReply).toBe(true);
  });

  it('carries the opener cap when replying opens the thread', () => {
    expect(replyRules(conversation({ state: 'awaiting_reply', openedById: ME }), ME, OWNER)).toEqual({
      canReply: true,
      maxLength: 240,
    });
  });
});

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, invalidate, wrapper };
}

describe('useStoryReply', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getConversation as jest.Mock).mockResolvedValue(conversation());
  });

  it('from a thread: uses that conversation, and sends a reply to the photo on screen (migration 0017)', async () => {
    const props = { conversationId: CONV, ownerId: OWNER, viewerId: ME, enabled: true };
    const { wrapper, invalidate } = setup();
    (sendMessage as jest.Mock).mockResolvedValue({ id: 'm1' });
    const { result } = await renderHook(() => useStoryReply(props), { wrapper });

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(findConversationIdWith).not.toHaveBeenCalled();
    expect(getConversation).toHaveBeenCalledWith(CONV);

    await act(async () => {
      await result.current!.onSend('love this one', 'p1');
    });
    expect(sendMessage).toHaveBeenCalledWith({
      conversationId: CONV,
      body: 'love this one',
      replyTo: { albumPhotoId: 'p1' },
    });
    // No media, and never a message reference: only the photo on screen.
    expect(Object.keys((sendMessage as jest.Mock).mock.calls[0][0]).sort()).toEqual(['body', 'conversationId', 'replyTo']);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['messages', CONV] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['conversations'] });
    await act(async () => {});
  });

  it('from the albums list: looks the conversation up from the owner', async () => {
    (findConversationIdWith as jest.Mock).mockResolvedValue(CONV);
    const props = { ownerId: OWNER, viewerId: ME, enabled: true };
    const { wrapper } = setup();
    const { result } = await renderHook(() => useStoryReply(props), { wrapper });
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(findConversationIdWith).toHaveBeenCalledWith(OWNER);
    expect(getConversation).toHaveBeenCalledWith(CONV);
    await act(async () => {});
  });

  it('no conversation with the owner: no bar', async () => {
    (findConversationIdWith as jest.Mock).mockResolvedValue(null);
    const props = { ownerId: OWNER, viewerId: ME, enabled: true };
    const { wrapper } = setup();
    const { result } = await renderHook(() => useStoryReply(props), { wrapper });
    await waitFor(() => expect(findConversationIdWith).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current).toBeNull();
    expect(getConversation).not.toHaveBeenCalled();
  });

  it('a conversation the viewer may not write to: no bar', async () => {
    (getConversation as jest.Mock).mockResolvedValue(conversation({ state: 'expired' }));
    const props = { conversationId: CONV, ownerId: OWNER, viewerId: ME, enabled: true };
    const { wrapper } = setup();
    const { result } = await renderHook(() => useStoryReply(props), { wrapper });
    await waitFor(() => expect(getConversation).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current).toBeNull();
  });

  it('the owner looking at their own album: no bar, and nothing is read', async () => {
    const props = { conversationId: CONV, ownerId: OWNER, viewerId: OWNER, enabled: true };
    const { wrapper } = setup();
    const { result } = await renderHook(() => useStoryReply(props), { wrapper });
    expect(result.current).toBeNull();
    expect(getConversation).not.toHaveBeenCalled();
  });

  it('a refusal comes back neutral, and a thread that has gone takes the bar with it', async () => {
    const props = { conversationId: CONV, ownerId: OWNER, viewerId: ME, enabled: true };
    const { wrapper } = setup();
    const { result } = await renderHook(() => useStoryReply(props), { wrapper });
    await waitFor(() => expect(result.current).not.toBeNull());

    (sendMessage as jest.Mock).mockRejectedValue({ code: '42501', message: 'not allowed' });
    let thrown: unknown;
    await act(async () => {
      await result.current!.onSend('hey').catch((e: unknown) => {
        thrown = e;
      });
    });
    expect(thrown).toBeInstanceOf(RefusedError);

    (sendMessage as jest.Mock).mockRejectedValue(new GoneError());
    (getConversation as jest.Mock).mockResolvedValue(null);
    await act(async () => {
      await result.current!.onSend('hey').catch((e: unknown) => {
        thrown = e;
      });
    });
    expect(thrown).toBeInstanceOf(GoneError);
    await waitFor(() => expect(result.current).toBeNull());
    await act(async () => {});
  });
});
