/**
 * The album's one video in the story (`albums/StoryViewer.tsx` +
 * `albums/StoryVideo.tsx`, migration 0025): its poster shows until the
 * player is ready, it plays with the same `expo-video` player chat uses,
 * the story's clock waits out the video's own length instead of the photo
 * interval, anything that holds the story pauses the video, and the owner's
 * `…` offers `remove this video` on the video only.
 */
import { act, fireEvent, render } from '@testing-library/react-native';
import { Image } from 'react-native';

jest.mock('expo-screen-capture', () => ({
  preventScreenCaptureAsync: jest.fn(() => Promise.resolve()),
  allowScreenCaptureAsync: jest.fn(() => Promise.resolve()),
}));

type MockPlayer = {
  source: unknown;
  status: string;
  loop: boolean;
  currentTime: number;
  play: jest.Mock;
  pause: jest.Mock;
  addListener: (event: string, fn: (payload: { status: string }) => void) => { remove: () => void };
  emit: (status: string) => void;
};

type MockListener = (payload: { status: string }) => void;

const mockPlayers: MockPlayer[] = [];

jest.mock('expo-video', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    useVideoPlayer: (source: unknown, setup?: (player: MockPlayer) => void) => {
      const ref = React.useRef(null);
      if (!ref.current) {
        const listeners = new Set<MockListener>();
        const player: MockPlayer = {
          source,
          status: 'loading',
          loop: true,
          currentTime: 0,
          play: jest.fn(),
          pause: jest.fn(),
          addListener: (_event, fn) => {
            listeners.add(fn);
            return { remove: () => listeners.delete(fn) };
          },
          emit: (status) => {
            player.status = status;
            listeners.forEach((fn) => fn({ status }));
          },
        };
        setup?.(player);
        mockPlayers.push(player);
        ref.current = player;
      }
      return ref.current;
    },
    VideoView: (props: { testID?: string; contentFit?: string; nativeControls?: boolean }) =>
      React.createElement(View, { testID: props.testID, contentFit: props.contentFit, nativeControls: props.nativeControls }),
  };
});

import { StoryViewer, storyItemDuration, type StoryPhoto, type StoryViewerProps } from '../albums/StoryViewer';
import { STORY_PHOTO_MS } from '../albums/storyNav';

const ITEMS: StoryPhoto[] = [
  { id: 'p1', uri: 'https://example.test/p1.jpg?token=1' },
  {
    id: 'v',
    kind: 'video',
    uri: 'https://example.test/v.mp4?token=1',
    posterUri: 'https://example.test/v-poster.jpg?token=1',
    durationMs: 12_400,
  },
  { id: 'p3', uri: 'https://example.test/p3.jpg?token=1' },
];

type Screen = Awaited<ReturnType<typeof render>>;

async function renderViewer(overrides: Partial<StoryViewerProps> = {}) {
  const onClose = jest.fn();
  const props: StoryViewerProps = { photos: ITEMS, title: 'summer', onClose, initialIndex: 1, ...overrides };
  const screen = await render(<StoryViewer {...props} />);
  return { screen, onClose };
}

function stageLabel(screen: Screen) {
  return screen.getByTestId('album-viewer-stage').props.accessibilityLabel;
}

function player(): MockPlayer {
  const last = mockPlayers[mockPlayers.length - 1];
  if (!last) throw new Error('no player');
  return last;
}

async function ready() {
  await act(async () => {
    player().emit('readyToPlay');
  });
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

let prefetchSpy: jest.SpyInstance;

beforeEach(() => {
  mockPlayers.length = 0;
  prefetchSpy = jest.spyOn(Image, 'prefetch').mockResolvedValue(true);
  jest.useFakeTimers();
});

afterEach(() => {
  prefetchSpy.mockRestore();
  jest.useRealTimers();
});

it('a video waits out its own length, a photo the interval', () => {
  expect(storyItemDuration(ITEMS[1], STORY_PHOTO_MS)).toBe(12_400);
  expect(storyItemDuration(ITEMS[0], STORY_PHOTO_MS)).toBe(STORY_PHOTO_MS);
  expect(storyItemDuration({ id: 'x', kind: 'video', uri: 'u', durationMs: null }, STORY_PHOTO_MS)).toBe(STORY_PHOTO_MS);
});

it('shows the poster, plays the video in chat’s player without native controls, cover-fit, not looping', async () => {
  const { screen } = await renderViewer();
  expect(screen.getByTestId('album-viewer-poster-v').props.source).toEqual({ uri: 'https://example.test/v-poster.jpg?token=1' });
  const view = screen.getByTestId('album-viewer-video-v');
  expect(view.props.contentFit).toBe('cover');
  expect(view.props.nativeControls).toBe(false);
  expect(player().source).toBe('https://example.test/v.mp4?token=1');
  expect(player().loop).toBe(false);
  expect(screen.queryByTestId('album-viewer-photo-v')).toBeNull();
});

it('does not start the clock or play until the video is ready, then plays for its whole length', async () => {
  const { screen } = await renderViewer();
  await advance(20_000);
  expect(stageLabel(screen)).toBe('photo 2 of 3');
  expect(player().play).not.toHaveBeenCalled();

  await ready();
  expect(player().play).toHaveBeenCalled();
  // Longer than a photo gets…
  await advance(STORY_PHOTO_MS);
  expect(stageLabel(screen)).toBe('photo 2 of 3');
  // …the video's own 12.4 seconds.
  await advance(12_400 - STORY_PHOTO_MS - 1);
  expect(stageLabel(screen)).toBe('photo 2 of 3');
  await advance(1);
  expect(stageLabel(screen)).toBe('photo 3 of 3');
});

it('holding the story pauses the video, and letting go plays it on', async () => {
  const { screen } = await renderViewer();
  await ready();
  const p = player();
  p.pause.mockClear();
  p.play.mockClear();

  const zone = screen.getByTestId('album-viewer-forward-zone');
  await fireEvent(zone, 'pressIn');
  expect(p.pause).toHaveBeenCalled();
  await advance(30_000);
  expect(stageLabel(screen)).toBe('photo 2 of 3');

  await fireEvent(zone, 'pressOut');
  expect(p.play).toHaveBeenCalled();
});

it('a video that fails to load says so, never moves on by itself, and re-signs once', async () => {
  const onRetry = jest.fn();
  const { screen } = await renderViewer({ onRetry });
  await act(async () => {
    player().emit('error');
  });
  expect(onRetry).toHaveBeenCalledTimes(1);
  expect(await screen.findByText("this video didn't load.")).toBeTruthy();
  await advance(30_000);
  expect(stageLabel(screen)).toBe('photo 2 of 3');
});

it('on a wide screen, the backdrop is the poster, blurred', async () => {
  const { screen } = await renderViewer();
  await act(async () => {
    screen.getByTestId('album-viewer').props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 900, height: 800 } } });
  });
  const backdrop = screen.getByTestId('album-viewer-backdrop-image');
  expect(backdrop.props.source).toEqual({ uri: 'https://example.test/v-poster.jpg?token=1' });
  expect(backdrop.props.blurRadius).toBe(40);
});

it('prefetches the next item’s still: the video’s poster', async () => {
  await renderViewer({ initialIndex: 0 });
  expect(prefetchSpy).toHaveBeenCalledWith('https://example.test/v-poster.jpg?token=1');
});

it('the owner’s … offers remove this video on the video and remove this photo on a photo', async () => {
  const onRemove = jest.fn();
  const actions: StoryViewerProps['actions'] = [
    { key: 'remove', label: 'remove this photo', destructive: true, needsPhoto: true, kinds: ['photo'], onPress: onRemove },
    { key: 'remove-video', label: 'remove this video', destructive: true, needsPhoto: true, kinds: ['video'], onPress: onRemove },
  ];
  const { screen } = await renderViewer({ actions });
  await fireEvent.press(screen.getByTestId('album-viewer-more'));
  expect(screen.queryByTestId('album-viewer-action-remove')).toBeNull();
  await fireEvent.press(screen.getByTestId('album-viewer-action-remove-video'));
  expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: 'v', kind: 'video' }));

  await fireEvent.press(screen.getByTestId('album-viewer-back-zone'));
  expect(stageLabel(screen)).toBe('photo 1 of 3');
  await fireEvent.press(screen.getByTestId('album-viewer-more'));
  expect(screen.getByTestId('album-viewer-action-remove')).toBeTruthy();
  expect(screen.queryByTestId('album-viewer-action-remove-video')).toBeNull();
});
