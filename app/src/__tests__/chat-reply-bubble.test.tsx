/**
 * A message's reply affordances (decision 93): the quote above it, the drag
 * wrapper and screen reader `reply` action, press and hold, and the tint a
 * quote tap leaves. Also that keep-in-chat images stay bare (no bubble) with
 * all of it in place, and that the album story opens at a quoted photo.
 */
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 360, height: 780, scale: 3, fontScale: 1 }),
}));
jest.mock('expo-screen-capture', () => ({
  preventScreenCaptureAsync: jest.fn(() => Promise.resolve()),
  allowScreenCaptureAsync: jest.fn(() => Promise.resolve()),
}));

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Image, StyleSheet, Text } from 'react-native';
import { MessageBubble, type ThreadMessage } from '../chat/MessageBubble';
import { StoryViewer } from '../albums/StoryViewer';

const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const THEM = 'bbbbbbbb-0000-4000-8000-000000000002';

const base = (overrides: Partial<ThreadMessage> = {}): ThreadMessage => ({
  id: 'm1',
  conversation_id: 'conv-1',
  sender_id: THEM,
  body: 'hello',
  media_path: null,
  media_kind: null,
  view_limit: null,
  views_used: 0,
  media_duration_ms: null,
  media_bytes: null,
  media_width: null,
  media_height: null,
  media_poster_path: null,
  created_at: '2026-09-29T10:00:00.000Z',
  reply_to_message_id: null,
  reply_to_album_photo_id: null,
  reply_kind: null,
  ...overrides,
});

describe('MessageBubble — replies', () => {
  it('wraps a message in the reply drag and offers reply to a screen reader', async () => {
    const onReply = jest.fn();
    const screen = await render(<MessageBubble message={base()} meId={ME} onReply={onReply} />);
    expect(screen.getByTestId('message-drag-m1')).toBeTruthy();

    const row = screen.getByTestId('message-row-m1');
    expect(row.props.accessibilityActions).toEqual(expect.arrayContaining([{ name: 'reply', label: 'reply' }]));
    await act(async () => row.props.onAccessibilityAction({ nativeEvent: { actionName: 'reply' } }));
    expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
  });

  it('offers no reply while a message is still sending or failed', async () => {
    const onReply = jest.fn();
    const screen = await render(<MessageBubble message={base({ pending: true })} meId={ME} onReply={onReply} />);
    expect(screen.getByTestId('message-row-m1').props.accessibilityActions).toBeUndefined();
  });

  it('without onReply (a locked thread) there is no drag at all', async () => {
    const screen = await render(<MessageBubble message={base()} meId={ME} />);
    expect(screen.queryByTestId('message-drag-m1')).toBeNull();
  });

  it('draws the quote above the message', async () => {
    const screen = await render(
      <MessageBubble message={base()} meId={ME} quote={<Text testID="the-quote">quoted</Text>} />
    );
    expect(screen.getByTestId('the-quote')).toBeTruthy();
  });

  it('press and hold hands the message and an anchor to the menu', async () => {
    const onLongPress = jest.fn();
    const screen = await render(<MessageBubble message={base()} meId={ME} onLongPress={onLongPress} />);
    await fireEvent(screen.getByTestId('message-hold-m1'), 'longPress', { nativeEvent: { pageX: 40, pageY: 300 } });
    await waitFor(() => expect(onLongPress).toHaveBeenCalledTimes(1));
    const [message, anchor] = onLongPress.mock.calls[0]!;
    expect(message.id).toBe('m1');
    expect(anchor).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
  });

  it('tints the message a quote tap landed on', async () => {
    const screen = await render(<MessageBubble message={base()} meId={ME} highlighted />);
    expect(screen.getByTestId('message-highlighted-m1')).toBeTruthy();
  });

  it('keeps a keep-in-chat image bare (no bubble) with the reply affordances in place', async () => {
    const screen = await render(
      <MessageBubble
        message={base({ body: null, media_path: 'conv-1/m1.jpg', media_kind: 'photo', media_width: 1200, media_height: 1600 })}
        meId={ME}
        mediaUrl="https://signed/m1.jpg"
        onReply={jest.fn()}
        onLongPress={jest.fn()}
        quote={<Text>quoted</Text>}
      />
    );
    expect(screen.queryByTestId('message-body-m1')).toBeNull();
    const frame = StyleSheet.flatten(screen.getByTestId('message-media-m1').props.style) as Record<string, unknown>;
    expect(frame.backgroundColor).toBeUndefined();
    expect(frame.width as number).toBeLessThanOrEqual(Math.round(360 * 0.7));
    expect(Math.abs((frame.width as number) / (frame.height as number) - 3 / 4)).toBeLessThan(0.02);
  });
});

describe('StoryViewer — opening at a quoted photo', () => {
  const PHOTOS = [
    { id: 'p1', uri: 'https://example.test/p1.jpg' },
    { id: 'p2', uri: 'https://example.test/p2.jpg' },
    { id: 'p3', uri: 'https://example.test/p3.jpg' },
  ];

  beforeEach(() => {
    jest.spyOn(Image, 'prefetch').mockResolvedValue(true);
  });

  it('opens at that photo, even when the photos arrive after it opened', async () => {
    const screen = await render(<StoryViewer photos={[]} loading initialPhotoId="p3" onClose={jest.fn()} />);
    await screen.rerender(<StoryViewer photos={PHOTOS} initialPhotoId="p3" onClose={jest.fn()} />);
    await waitFor(() =>
      expect(screen.getByTestId('album-viewer-stage').props.accessibilityLabel).toBe('photo 3 of 3')
    );
  });

  it('opens at the start when the photo is not in the album any more', async () => {
    const screen = await render(<StoryViewer photos={PHOTOS} initialPhotoId="gone" onClose={jest.fn()} />);
    expect(screen.getByTestId('album-viewer-stage').props.accessibilityLabel).toBe('photo 1 of 3');
  });
});
