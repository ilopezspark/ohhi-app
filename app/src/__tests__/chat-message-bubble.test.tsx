/**
 * `MessageBubble` variant matrix (`docs/chat-media-plan.md` §3/§7): the plain
 * inline keep-in-chat render, the keep-in-chat video poster + play
 * affordance, and every limited-media pill state on both sides.
 */
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { MessageBubble, type ThreadMessage } from '../chat/MessageBubble';
import { radii } from '../theme/tokens';

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

function flat(style: unknown): Record<string, unknown> {
  return StyleSheet.flatten(style as never) ?? {};
}

describe('MessageBubble — keep-in-chat media', () => {
  it('renders the image itself: no bubble fill, border or padding around it', async () => {
    const message = base({ media_path: 'conv-1/m1.jpg', media_kind: 'photo', media_width: 1600, media_height: 1200 });
    const screen = await render(<MessageBubble message={message} meId={ME} mediaUrl="https://signed/m1.jpg" />);

    const frame = flat(screen.getByTestId('message-media-m1').props.style);
    expect(frame.backgroundColor).toBeUndefined();
    expect(frame.borderWidth).toBeUndefined();
    expect(frame.padding).toBeUndefined();
    expect(frame.paddingHorizontal).toBeUndefined();
    expect(frame.borderRadius).toBe(radii.lg);
    // No text bubble is drawn for a media-only message.
    expect(screen.queryByTestId('message-body-m1')).toBeNull();
    expect(screen.getByTestId('message-media-image-m1')).toBeTruthy();
  });

  it('sizes the frame to the photo’s own aspect ratio, capped', async () => {
    const landscape = base({ media_path: 'conv-1/m1.jpg', media_kind: 'photo', media_width: 1600, media_height: 1200 });
    const screen = await render(<MessageBubble message={landscape} meId={ME} mediaUrl="https://signed/m1.jpg" />);
    const frame = flat(screen.getByTestId('message-media-m1').props.style);
    expect((frame.width as number) / (frame.height as number)).toBeCloseTo(4 / 3, 1);
    expect(frame.width as number).toBeLessThanOrEqual(300);

    const portrait = base({ id: 'm2', media_path: 'conv-1/m2.jpg', media_kind: 'photo', media_width: 1200, media_height: 1600 });
    const screen2 = await render(<MessageBubble message={portrait} meId={ME} mediaUrl="https://signed/m2.jpg" />);
    const frame2 = flat(screen2.getByTestId('message-media-m2').props.style);
    expect(frame2.height as number).toBeLessThanOrEqual(360);
    expect((frame2.width as number) / (frame2.height as number)).toBeCloseTo(3 / 4, 1);
  });

  it('opens the full-screen viewer when the photo is tapped', async () => {
    const onOpenMedia = jest.fn();
    const message = base({ media_path: 'conv-1/m1.jpg', media_kind: 'photo' });
    const screen = await render(
      <MessageBubble message={message} meId={ME} mediaUrl="https://signed/m1.jpg" onOpenMedia={onOpenMedia} />
    );
    fireEvent.press(screen.getByTestId('message-media-m1'));
    expect(onOpenMedia).toHaveBeenCalledWith(message);
  });

  it('falls back to a placeholder when the photo URL failed to sign', async () => {
    const message = base({ media_path: 'conv-1/m1.jpg', media_kind: 'photo' });
    const screen = await render(<MessageBubble message={message} meId={ME} />);
    expect(screen.getByTestId('message-media-placeholder-m1')).toBeTruthy();
  });

  it('renders a video poster with a tap affordance that opens the viewer, same frameless treatment', async () => {
    const onOpenMedia = jest.fn();
    const message = base({ media_path: 'conv-1/m1.mp4', media_kind: 'video', media_poster_path: 'conv-1/m1-poster.jpg' });
    const screen = await render(
      <MessageBubble message={message} meId={ME} mediaUrl="https://signed/poster.jpg" onOpenMedia={onOpenMedia} />
    );
    expect(flat(screen.getByTestId('message-media-m1').props.style).backgroundColor).toBeUndefined();
    fireEvent.press(screen.getByTestId('message-media-m1'));
    expect(onOpenMedia).toHaveBeenCalledWith(message);
  });

  it('keeps limited media as a bubble with its pill (unchanged)', async () => {
    const message = base({ media_path: 'x', media_kind: 'photo', view_limit: 1, views_used: 0, sender_id: THEM });
    const screen = await render(<MessageBubble message={message} meId={ME} />);
    expect(flat(screen.getByTestId('message-m1').props.style).backgroundColor).toBeDefined();
    expect(screen.queryByTestId('message-media-m1')).toBeNull();
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
