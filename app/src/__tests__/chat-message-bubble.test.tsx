/**
 * `MessageBubble` variant matrix (`docs/chat-media-plan.md` §3/§7): the plain
 * inline keep-in-chat render, the keep-in-chat video poster + play
 * affordance, and every limited-media pill state on both sides.
 */
import { fireEvent, render } from '@testing-library/react-native';
import { MessageBubble, type ThreadMessage } from '../chat/MessageBubble';

const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const THEM = 'bbbbbbbb-0000-4000-8000-000000000002';

const base = (overrides: Partial<ThreadMessage> = {}): ThreadMessage => ({
  id: 'm1',
  conversation_id: 'conv-1',
  sender_id: THEM,
  body: null,
  media_path: null,
  media_kind: null,
  view_limit: null,
  views_used: 0,
  media_duration_ms: null,
  media_bytes: null,
  media_width: null,
  media_height: null,
  media_poster_path: null,
  created_at: '2026-09-28T10:00:00.000Z',
  ...overrides,
});

describe('MessageBubble — keep-in-chat media', () => {
  it('renders a plain inline image for a keep-in-chat photo, no tap handler', async () => {
    const onOpenMedia = jest.fn();
    const message = base({ media_path: 'conv-1/m1.jpg', media_kind: 'photo' });
    const screen = await render(
      <MessageBubble message={message} meId={ME} mediaUrl="https://signed/m1.jpg" onOpenMedia={onOpenMedia} />
    );
    expect(screen.getByTestId('message-media-m1')).toBeTruthy();
  });

  it('falls back to a placeholder when the photo URL failed to sign', async () => {
    const message = base({ media_path: 'conv-1/m1.jpg', media_kind: 'photo' });
    const screen = await render(<MessageBubble message={message} meId={ME} />);
    expect(screen.getByTestId('message-media-placeholder-m1')).toBeTruthy();
  });

  it('renders a video poster with a tap affordance that opens the viewer', async () => {
    const onOpenMedia = jest.fn();
    const message = base({ media_path: 'conv-1/m1.mp4', media_kind: 'video', media_poster_path: 'conv-1/m1-poster.jpg' });
    const screen = await render(
      <MessageBubble message={message} meId={ME} mediaUrl="https://signed/poster.jpg" onOpenMedia={onOpenMedia} />
    );
    fireEvent.press(screen.getByTestId('message-media-m1'));
    expect(onOpenMedia).toHaveBeenCalledWith(message);
  });
});

describe('MessageBubble — limited media, recipient side', () => {
  it('shows "View photo" while unopened and tapping opens the viewer', async () => {
    const onOpenMedia = jest.fn();
    const message = base({ media_path: 'x', media_kind: 'photo', view_limit: 1, views_used: 0, sender_id: THEM });
    const screen = await render(<MessageBubble message={message} meId={ME} onOpenMedia={onOpenMedia} />);

    expect(screen.getByText('View photo')).toBeTruthy();
    fireEvent.press(screen.getByTestId('message-limited-press-m1'));
    expect(onOpenMedia).toHaveBeenCalledWith(message);
  });

  it('shows "View video" for a video kind', async () => {
    const message = base({ media_path: 'x', media_kind: 'video', view_limit: 1, views_used: 0, sender_id: THEM });
    const screen = await render(<MessageBubble message={message} meId={ME} />);
    expect(screen.getByText('View video')).toBeTruthy();
  });

  it('shows "1 left" after the first of two opens', async () => {
    const message = base({ media_path: 'x', media_kind: 'photo', view_limit: 2, views_used: 1, sender_id: THEM });
    const screen = await render(<MessageBubble message={message} meId={ME} />);
    expect(screen.getByText('View photo · 1 left')).toBeTruthy();
  });

  it('shows "Opened", not tappable, once views_used reaches the limit', async () => {
    const message = base({ media_path: 'x', media_kind: 'photo', view_limit: 1, views_used: 1, sender_id: THEM });
    const screen = await render(<MessageBubble message={message} meId={ME} />);
    expect(screen.getByText('Opened')).toBeTruthy();
    expect(screen.queryByTestId('message-limited-press-m1')).toBeNull();
  });

  it('shows "Opened" from the local recipientExhausted flag even if views_used has not caught up yet', async () => {
    const message = base({ media_path: 'x', media_kind: 'photo', view_limit: 1, views_used: 0, sender_id: THEM });
    const screen = await render(<MessageBubble message={message} meId={ME} recipientExhausted />);
    expect(screen.getByText('Opened')).toBeTruthy();
    expect(screen.queryByTestId('message-limited-press-m1')).toBeNull();
  });
});

describe('MessageBubble — limited media, sender side', () => {
  it('shows "Photo · view once" before any open, and stays tappable (CM-3 preview)', async () => {
    const onOpenMedia = jest.fn();
    const message = base({ media_path: 'x', media_kind: 'photo', view_limit: 1, views_used: 0, sender_id: ME });
    const screen = await render(<MessageBubble message={message} meId={ME} onOpenMedia={onOpenMedia} />);

    expect(screen.getByText('Photo · view once')).toBeTruthy();
    fireEvent.press(screen.getByTestId('message-limited-press-m1'));
    expect(onOpenMedia).toHaveBeenCalledWith(message);
  });

  it('shows "Video · view twice" before any open', async () => {
    const message = base({ media_path: 'x', media_kind: 'video', view_limit: 2, views_used: 0, sender_id: ME });
    const screen = await render(<MessageBubble message={message} meId={ME} />);
    expect(screen.getByText('Video · view twice')).toBeTruthy();
  });

  it('shows "Opened" once a view-once send has been opened', async () => {
    const message = base({ media_path: 'x', media_kind: 'photo', view_limit: 1, views_used: 1, sender_id: ME });
    const screen = await render(<MessageBubble message={message} meId={ME} />);
    expect(screen.getByText('Opened')).toBeTruthy();
  });

  it('shows "Opened 1 of 2" after the first of two opens', async () => {
    const message = base({ media_path: 'x', media_kind: 'photo', view_limit: 2, views_used: 1, sender_id: ME });
    const screen = await render(<MessageBubble message={message} meId={ME} />);
    expect(screen.getByText('Opened 1 of 2')).toBeTruthy();
  });

  it('shows "Opened 2 of 2" once fully exhausted', async () => {
    const message = base({ media_path: 'x', media_kind: 'photo', view_limit: 2, views_used: 2, sender_id: ME });
    const screen = await render(<MessageBubble message={message} meId={ME} />);
    expect(screen.getByText('Opened 2 of 2')).toBeTruthy();
  });

  it('stays tappable even after exhaustion — the sender has no "used up" state (CM-3)', async () => {
    const message = base({ media_path: 'x', media_kind: 'photo', view_limit: 2, views_used: 2, sender_id: ME });
    const screen = await render(<MessageBubble message={message} meId={ME} onOpenMedia={jest.fn()} />);
    expect(screen.getByTestId('message-limited-press-m1')).toBeTruthy();
  });
});

describe('MessageBubble — retry (unchanged)', () => {
  it('still offers retry for a failed send', async () => {
    const onRetry = jest.fn();
    const message = base({ body: 'hi', failed: true });
    const screen = await render(<MessageBubble message={message} meId={ME} onRetry={onRetry} />);
    fireEvent.press(screen.getByTestId('message-retry-m1'));
    expect(onRetry).toHaveBeenCalledWith(message);
  });
});
