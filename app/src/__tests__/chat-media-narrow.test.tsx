/**
 * Keep-in-chat media at a narrow window (a fold phone's cover screen, ~360pt
 * wide): the photo keeps its real aspect ratio, sizes itself from the loaded
 * image when the row has no stored size (rows sent before migration 0010),
 * trusts the loaded pixels over a stored size that disagrees with them, and
 * is never drawn inside a bubble.
 */
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 360, height: 780, scale: 3, fontScale: 1 }),
}));

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
  media_path: 'conv-1/m1.jpg',
  media_kind: 'photo',
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

function frameOf(screen: Awaited<ReturnType<typeof render>>, id = 'm1') {
  const style = StyleSheet.flatten(screen.getByTestId(`message-media-${id}`).props.style) as Record<string, unknown>;
  return { width: style.width as number, height: style.height as number, style };
}

async function load(screen: Awaited<ReturnType<typeof render>>, width: number, height: number, id = 'm1') {
  await fireEvent(screen.getByTestId(`message-media-image-${id}`), 'load', { nativeEvent: { source: { width, height } } });
}

describe('keep-in-chat media at a 360pt window', () => {
  it.each([
    ['portrait 3:4', 1200, 1600],
    ['landscape 4:3', 1600, 1200],
    ['square', 1000, 1000],
    ['phone screenshot 9:20', 1080, 2400],
    ['wide 16:9', 1920, 1080],
  ])('keeps the real aspect ratio of a %s photo', async (_label, w, h) => {
    const screen = await render(
      <MessageBubble message={base({ media_width: w, media_height: h })} meId={ME} mediaUrl="https://signed/m1.jpg" />
    );
    const frame = frameOf(screen);
    expect(frame.width).toBeLessThanOrEqual(Math.round(360 * 0.7));
    expect(frame.height).toBeLessThanOrEqual(360);
    // Whole-pixel rounding only.
    expect(Math.abs(frame.width / frame.height - w / h)).toBeLessThan(0.02);
  });

  it('sizes a row with no stored size (sent before 0010) from the loaded image, frameless', async () => {
    const legacy = base({ media_kind: null, media_width: null, media_height: null });
    const screen = await render(<MessageBubble message={legacy} meId={ME} mediaUrl="https://signed/m1.jpg" />);

    await load(screen, 900, 1600);

    const frame = frameOf(screen);
    expect(Math.abs(frame.width / frame.height - 900 / 1600)).toBeLessThan(0.02);
    expect(frame.style.backgroundColor).toBeUndefined();
    expect(frame.style.borderWidth).toBeUndefined();
    expect(frame.style.padding).toBeUndefined();
    expect(frame.style.borderRadius).toBe(radii.lg);
    expect(screen.queryByTestId('message-body-m1')).toBeNull();
  });

  it('trusts the loaded pixels over a stored size that disagrees with them', async () => {
    // The picker reported landscape; the uploaded pixels are portrait.
    const swapped = base({ media_width: 4000, media_height: 3000 });
    const screen = await render(<MessageBubble message={swapped} meId={ME} mediaUrl="https://signed/m1.jpg" />);
    expect(frameOf(screen).width).toBeGreaterThan(frameOf(screen).height);

    await load(screen, 1200, 1600);

    const frame = frameOf(screen);
    expect(Math.abs(frame.width / frame.height - 3 / 4)).toBeLessThan(0.02);
  });
});
