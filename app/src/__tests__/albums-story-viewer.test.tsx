/**
 * The album story (`albums/StoryViewer.tsx`): full-bleed layout, the
 * auto-advance timer and everything that pauses it, tap zones and their
 * boundaries, the header (owner's face, name, album name), the reply bar,
 * owner vs recipient controls with confirm before remove, load/failure
 * states, prefetch, screenshot prevention and the accessibility surface.
 */
import { act, fireEvent, render } from '@testing-library/react-native';
import { AccessibilityInfo, AppState, BackHandler, type AppStateStatus } from 'react-native';
import { Image } from 'expo-image';

const mockPrevent = jest.fn((_key?: string) => Promise.resolve());
const mockAllow = jest.fn((_key?: string) => Promise.resolve());
jest.mock('expo-screen-capture', () => ({
  preventScreenCaptureAsync: (key: string) => mockPrevent(key),
  allowScreenCaptureAsync: (key: string) => mockAllow(key),
}));

import { StoryViewer, type StoryPhoto, type StoryViewerProps } from '../albums/StoryViewer';
import { REPLY_FAILED_COPY, REPLY_PLACEHOLDER, SENT_NOTICE_MS } from '../albums/StoryReplyBar';

const PHOTOS: StoryPhoto[] = [
  { id: 'p1', uri: 'https://example.test/p1.jpg?token=1' },
  { id: 'p2', uri: 'https://example.test/p2.jpg?token=1' },
  { id: 'p3', uri: 'https://example.test/p3.jpg?token=1' },
];
const OWNER = { name: 'Maya', avatarUri: 'https://example.test/maya.jpg?token=1' };

let prefetchSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  prefetchSpy = jest.spyOn(Image, 'loadAsync').mockResolvedValue({} as never);
});

afterEach(() => {
  prefetchSpy.mockRestore();
  jest.useRealTimers();
});

type Screen = Awaited<ReturnType<typeof render>>;

async function renderViewer(overrides: Partial<StoryViewerProps> = {}) {
  const onClose = jest.fn();
  const props: StoryViewerProps = { photos: PHOTOS, title: 'summer', onClose, ...overrides };
  const screen = await render(<StoryViewer {...props} />);
  return { screen, onClose: props.onClose as jest.Mock, props };
}

function stageLabel(screen: Screen) {
  return screen.getByTestId('album-viewer-stage').props.accessibilityLabel;
}

async function load(screen: Screen, id: string) {
  await act(async () => {
    fireEvent(screen.getByTestId(`album-viewer-photo-${id}`), 'load', { nativeEvent: {} });
  });
}

/**
 * Lays the story out at `width` x `height`. Called on the handler itself:
 * RNTL's `fireEvent` skips a view whose responder declines touches, and the
 * root carries the pan responder's handlers.
 */
async function layout(screen: Screen, width: number, height: number) {
  await act(async () => {
    screen.getByTestId('album-viewer').props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height } } });
  });
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

describe('full bleed', () => {
  it('covers the screen with the photo, centred, never letterboxed', async () => {
    const { screen } = await renderViewer();
    const photo = screen.getByTestId('album-viewer-photo-p1');
    expect(photo.props.contentFit).toBe('cover');
    expect(photo).toHaveStyle({ objectFit: 'cover' });
  });

  it('on a phone, including a fold phone cover screen, the photo column is the full width with no backdrop', async () => {
    const { screen } = await renderViewer();
    await layout(screen, 360, 880);
    expect(screen.getByTestId('album-viewer-column')).toHaveStyle({ width: 360, left: 0 });
    expect(screen.queryByTestId('album-viewer-backdrop')).toBeNull();
  });

  it('on a wide screen, a centred 9:16 column of the full height over a blurred copy of the photo', async () => {
    const { screen } = await renderViewer();
    await layout(screen, 900, 800);
    expect(screen.getByTestId('album-viewer-column')).toHaveStyle({ width: 450, left: 225 });
    expect(screen.getByTestId('album-viewer-backdrop')).toBeTruthy();
  });
});

describe('auto-advance', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  it('does not start until the photo has loaded', async () => {
    const { screen } = await renderViewer();
    await advance(12_000);
    expect(stageLabel(screen)).toBe('photo 1 of 3');
    await load(screen, 'p1');
    await advance(4_999);
    expect(stageLabel(screen)).toBe('photo 1 of 3');
    await advance(1);
    expect(stageLabel(screen)).toBe('photo 2 of 3');
  });

  it('each photo gets its own 5 seconds, and the story closes after the last one', async () => {
    const { screen, onClose } = await renderViewer();
    await load(screen, 'p1');
    await advance(5_000);
    await load(screen, 'p2');
    await advance(5_000);
    expect(stageLabel(screen)).toBe('photo 3 of 3');
    await load(screen, 'p3');
    expect(onClose).not.toHaveBeenCalled();
    await advance(5_000);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('press and hold pauses and hides the chrome; release resumes from where it paused', async () => {
    const { screen } = await renderViewer({ owner: OWNER });
    await load(screen, 'p1');
    await advance(2_000);

    const zone = screen.getByTestId('album-viewer-forward-zone');
    await fireEvent(zone, 'pressIn');
    await fireEvent(zone, 'longPress');
    expect(screen.queryByTestId('album-viewer-chrome')).toBeNull();
    expect(screen.queryByTestId('album-viewer-close')).toBeNull();
    await advance(20_000);
    expect(stageLabel(screen)).toBe('photo 1 of 3');

    await fireEvent(zone, 'pressOut');
    expect(screen.getByTestId('album-viewer-chrome')).toBeTruthy();
    await advance(2_999);
    expect(stageLabel(screen)).toBe('photo 1 of 3');
    await advance(1);
    expect(stageLabel(screen)).toBe('photo 2 of 3');
  });

  it('pauses while the reply field has focus', async () => {
    const onSend = jest.fn().mockResolvedValue(undefined);
    const { screen } = await renderViewer({ reply: { onSend } });
    await load(screen, 'p1');
    await advance(1_000);
    await fireEvent(screen.getByTestId('album-viewer-reply-input'), 'focus');
    await advance(30_000);
    expect(stageLabel(screen)).toBe('photo 1 of 3');
    await fireEvent(screen.getByTestId('album-viewer-reply-input'), 'blur');
    await advance(4_000);
    expect(stageLabel(screen)).toBe('photo 2 of 3');
  });

  it('pauses while the app is in the background', async () => {
    const listeners: Array<(state: AppStateStatus) => void> = [];
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      listeners.push(listener as (state: AppStateStatus) => void);
      return { remove: jest.fn() } as never;
    });
    const { screen } = await renderViewer();
    await load(screen, 'p1');
    await advance(1_000);
    await act(async () => listeners.forEach((l) => l('background')));
    await advance(30_000);
    expect(stageLabel(screen)).toBe('photo 1 of 3');
    await act(async () => listeners.forEach((l) => l('active')));
    await advance(4_000);
    expect(stageLabel(screen)).toBe('photo 2 of 3');
    spy.mockRestore();
  });

  it('pauses while the … sheet is open', async () => {
    const { screen } = await renderViewer({ actions: [{ key: 'edit', label: 'edit album', onPress: jest.fn() }] });
    await load(screen, 'p1');
    await fireEvent.press(screen.getByTestId('album-viewer-more'));
    await advance(30_000);
    expect(stageLabel(screen)).toBe('photo 1 of 3');
  });

  it('pauses while held from outside (another screen on top)', async () => {
    const { screen, props } = await renderViewer({ paused: true });
    await load(screen, 'p1');
    await advance(30_000);
    expect(stageLabel(screen)).toBe('photo 1 of 3');
    await screen.rerender(<StoryViewer {...props} paused={false} />);
    await advance(5_000);
    expect(stageLabel(screen)).toBe('photo 2 of 3');
  });

  it('never moves on its own with reduced motion on; the bar just shows position', async () => {
    const spy = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const { screen } = await renderViewer();
    await act(async () => {});
    await load(screen, 'p1');
    await advance(30_000);
    expect(stageLabel(screen)).toBe('photo 1 of 3');
    expect(screen.getByTestId('album-viewer-bar-0-full', { includeHiddenElements: true })).toBeTruthy();
    // Still goes by hand.
    await fireEvent.press(screen.getByTestId('album-viewer-forward-zone'));
    expect(stageLabel(screen)).toBe('photo 2 of 3');
    spy.mockRestore();
  });

  it('never moves on its own while a screen reader is running', async () => {
    const spy = jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    const { screen } = await renderViewer();
    await act(async () => {});
    await load(screen, 'p1');
    await advance(30_000);
    expect(stageLabel(screen)).toBe('photo 1 of 3');
    spy.mockRestore();
  });

  it('on web, ignores the screen reader answer (react-native-web always says yes) and still moves on', async () => {
    const { Platform } = require('react-native');
    const original = Platform.OS;
    Platform.OS = 'web';
    const spy = jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    try {
      const { screen } = await renderViewer();
      await act(async () => {});
      await load(screen, 'p1');
      await advance(5_000);
      expect(stageLabel(screen)).toBe('photo 2 of 3');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      Platform.OS = original;
      spy.mockRestore();
    }
  });

  it('tap back on the first photo restarts its timer', async () => {
    const { screen, onClose } = await renderViewer();
    await load(screen, 'p1');
    await advance(4_000);
    await fireEvent.press(screen.getByTestId('album-viewer-back-zone'));
    await advance(4_000);
    expect(stageLabel(screen)).toBe('photo 1 of 3');
    await advance(1_000);
    expect(stageLabel(screen)).toBe('photo 2 of 3');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('tap back goes to the previous photo with a fresh 5 seconds', async () => {
    const { screen } = await renderViewer();
    await load(screen, 'p1');
    await fireEvent.press(screen.getByTestId('album-viewer-forward-zone'));
    await load(screen, 'p2');
    await advance(3_000);
    await fireEvent.press(screen.getByTestId('album-viewer-back-zone'));
    expect(stageLabel(screen)).toBe('photo 1 of 3');
    await advance(4_999);
    expect(stageLabel(screen)).toBe('photo 1 of 3');
    await advance(1);
    expect(stageLabel(screen)).toBe('photo 2 of 3');
  });

  it('a photo that failed to load never times out', async () => {
    const { screen } = await renderViewer();
    await act(async () => {
      fireEvent(screen.getByTestId('album-viewer-photo-p1'), 'error', { nativeEvent: {} });
    });
    await advance(30_000);
    expect(stageLabel(screen)).toBe('photo 1 of 3');
    expect(screen.getByTestId('album-viewer-failed')).toBeTruthy();
  });
});

describe('tap zones', () => {
  it('opens at the first photo by default, its bar filling, the ones ahead empty', async () => {
    const { screen } = await renderViewer();
    expect(screen.getByTestId('album-viewer-photo-p1')).toBeTruthy();
    expect(stageLabel(screen)).toBe('photo 1 of 3');
    expect(screen.getByTestId('album-viewer-bar-0-progress', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('album-viewer-bar-1-progress', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByTestId('album-viewer-bar-1-full', { includeHiddenElements: true })).toBeNull();
  });

  it('the right zone advances at once, the left zone goes back', async () => {
    const { screen } = await renderViewer();
    await fireEvent.press(screen.getByTestId('album-viewer-forward-zone'));
    expect(screen.getByTestId('album-viewer-photo-p2')).toBeTruthy();
    expect(screen.getByTestId('album-viewer-bar-0-full', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('album-viewer-bar-1-progress', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(screen.getByTestId('album-viewer-back-zone'));
    expect(screen.getByTestId('album-viewer-photo-p1')).toBeTruthy();
  });

  it('the zones split a third back and two thirds forward', async () => {
    const { screen } = await renderViewer();
    expect(screen.getByTestId('album-viewer-back-zone')).toHaveStyle({ flex: 1 });
    expect(screen.getByTestId('album-viewer-forward-zone')).toHaveStyle({ flex: 2 });
  });

  it('going back on the first photo stays on it', async () => {
    const { screen, onClose } = await renderViewer();
    await fireEvent.press(screen.getByTestId('album-viewer-back-zone'));
    expect(screen.getByTestId('album-viewer-photo-p1')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('advancing past the last photo closes the story', async () => {
    const { screen, onClose } = await renderViewer({ initialIndex: 2 });
    expect(screen.getByTestId('album-viewer-photo-p3')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('album-viewer-forward-zone'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens at the requested photo, clamped into the album', async () => {
    const { screen } = await renderViewer({ initialIndex: 1 });
    expect(stageLabel(screen)).toBe('photo 2 of 3');
    await screen.unmount();
    const again = await renderViewer({ initialIndex: 12 });
    expect(stageLabel(again.screen)).toBe('photo 3 of 3');
  });

  it('prefetches the next two photos, and the one after as the story moves on', async () => {
    const PLUS = [...PHOTOS, { id: 'p4', uri: 'https://example.test/p4.jpg?token=1' }];
    const { screen } = await renderViewer({ photos: PLUS });
    expect(prefetchSpy).toHaveBeenCalledWith({ uri: PLUS[1].uri });
    expect(prefetchSpy).toHaveBeenCalledWith({ uri: PLUS[2].uri });
    expect(prefetchSpy).not.toHaveBeenCalledWith({ uri: PLUS[3].uri });
    await fireEvent.press(screen.getByTestId('album-viewer-forward-zone'));
    expect(prefetchSpy).toHaveBeenCalledWith({ uri: PLUS[3].uri });
  });

  it('keys a prefetched stored photo by its storage path, not its signed URL', async () => {
    const stored = 'https://x.supabase.co/storage/v1/object/sign/album-photos/owner/album/p2.jpg?token=abc';
    await renderViewer({ photos: [PHOTOS[0], { id: 'p2', uri: stored }] });
    expect(prefetchSpy).toHaveBeenCalledWith({ uri: stored, cacheKey: 'album-photos/owner/album/p2.jpg' });
  });

  it('a tap while typing a reply puts the keyboard away instead of moving', async () => {
    const { screen } = await renderViewer({ reply: { onSend: jest.fn() } });
    await fireEvent(screen.getByTestId('album-viewer-reply-input'), 'focus');
    await fireEvent.press(screen.getByTestId('album-viewer-forward-zone'));
    expect(stageLabel(screen)).toBe('photo 1 of 3');
  });
});

describe('header', () => {
  it('shows the owner’s round photo, their first name in lowercase and the album name', async () => {
    const { screen } = await renderViewer({ owner: OWNER });
    expect(screen.getByTestId('album-viewer-avatar-image').props.source).toEqual([{ uri: OWNER.avatarUri }]);
    expect(screen.getByTestId('album-viewer-owner')).toHaveTextContent('maya');
    expect(screen.getByTestId('album-viewer-title')).toHaveTextContent('summer');
  });

  it('falls back to a neutral circle with their initial when there is no photo, and a plain one without a name', async () => {
    const { screen } = await renderViewer({ owner: { name: 'Maya', avatarUri: null } });
    expect(screen.getByTestId('album-viewer-avatar-initial')).toHaveTextContent('m');
    await screen.unmount();
    const again = await renderViewer({ owner: { name: null, avatarUri: null } });
    expect(again.screen.getByTestId('album-viewer-avatar-blank')).toBeTruthy();
    expect(again.screen.queryByTestId('album-viewer-owner')).toBeNull();
  });

  it('tapping the owner opens their profile', async () => {
    const onOpenOwner = jest.fn();
    const { screen } = await renderViewer({ owner: OWNER, onOpenOwner });
    const link = screen.getByTestId('album-viewer-owner-link');
    expect(link.props.accessibilityLabel).toBe('maya, summer');
    await fireEvent.press(link);
    expect(onOpenOwner).toHaveBeenCalledTimes(1);
  });

  it('without a profile to open, the owner is not a button', async () => {
    const { screen } = await renderViewer({ owner: OWNER });
    expect(screen.queryByTestId('album-viewer-owner-link')).toBeNull();
  });

  it('close is labelled and closes', async () => {
    const { screen, onClose } = await renderViewer({ owner: OWNER });
    const close = screen.getByTestId('album-viewer-close');
    expect(close.props.accessibilityLabel).toBe('close');
    await fireEvent.press(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('reply bar', () => {
  it('is only there when given', async () => {
    const { screen } = await renderViewer({ owner: OWNER });
    expect(screen.queryByTestId('album-viewer-reply')).toBeNull();
  });

  it('is a labelled rounded field with the placeholder and a send button that waits for text', async () => {
    const { screen } = await renderViewer({ owner: OWNER, reply: { onSend: jest.fn(), maxLength: 240 } });
    const input = screen.getByTestId('album-viewer-reply-input');
    expect(input.props.placeholder).toBe(REPLY_PLACEHOLDER);
    expect(input.props.accessibilityLabel).toBe('reply to maya');
    expect(input.props.maxLength).toBe(240);
    expect(screen.getByTestId('album-viewer-reply-send').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(input, '   ');
    expect(screen.getByTestId('album-viewer-reply-send').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('sends the trimmed text, clears the field, says sent briefly and lets the story carry on', async () => {
    jest.useFakeTimers();
    const onSend = jest.fn().mockResolvedValue(undefined);
    const { screen } = await renderViewer({ reply: { onSend } });
    await load(screen, 'p1');
    const input = screen.getByTestId('album-viewer-reply-input');
    await fireEvent(input, 'focus');
    await fireEvent.changeText(input, '  love this one  ');
    await act(async () => {
      fireEvent.press(screen.getByTestId('album-viewer-reply-send'));
    });
    // The reply goes to the photo on screen.
    expect(onSend).toHaveBeenCalledWith('love this one', 'p1');
    expect(screen.getByTestId('album-viewer-reply-sent')).toHaveTextContent('sent');
    expect(screen.getByTestId('album-viewer-reply-input').props.value).toBe('');
    await fireEvent(screen.getByTestId('album-viewer-reply-input'), 'blur');
    await advance(SENT_NOTICE_MS);
    expect(screen.queryByTestId('album-viewer-reply-sent')).toBeNull();
    await advance(5_000);
    expect(stageLabel(screen)).toBe('photo 2 of 3');
  });

  it('a failed send keeps the text and says only that it did not send', async () => {
    const onSend = jest.fn().mockRejectedValue(new Error('not allowed'));
    const { screen } = await renderViewer({ reply: { onSend } });
    await fireEvent.changeText(screen.getByTestId('album-viewer-reply-input'), 'hey');
    await act(async () => {
      fireEvent.press(screen.getByTestId('album-viewer-reply-send'));
    });
    expect(screen.getByTestId('album-viewer-reply-failed')).toHaveTextContent(REPLY_FAILED_COPY);
    expect(screen.getByTestId('album-viewer-reply-input').props.value).toBe('hey');
    expect(screen.queryByText(/blocked|allowed|deleted|banned/i)).toBeNull();
  });
});

describe('owner controls', () => {
  it('a recipient gets no … and no save, download or share-out action', async () => {
    const { screen } = await renderViewer({ owner: OWNER, reply: { onSend: jest.fn() } });
    expect(screen.queryByTestId('album-viewer-more')).toBeNull();
    expect(screen.queryByText(/save|download|share/i)).toBeNull();
    expect(screen.queryByLabelText(/save|download|share/i)).toBeNull();
  });

  it('an action without a confirm runs straight away (edit)', async () => {
    const onEdit = jest.fn();
    const { screen } = await renderViewer({ actions: [{ key: 'edit', label: 'edit album', onPress: onEdit }] });
    await fireEvent.press(screen.getByTestId('album-viewer-more'));
    await fireEvent.press(screen.getByTestId('album-viewer-action-edit'));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('album-viewer-menu')).toBeNull();
  });

  it('removing the photo on screen asks first, and only removes on yes', async () => {
    const onRemove = jest.fn();
    const remove = {
      key: 'remove',
      label: 'remove this photo',
      destructive: true,
      needsPhoto: true,
      confirm: { title: 'remove this photo?', confirmLabel: 'remove', cancelLabel: 'keep it' },
      onPress: onRemove,
    };
    const { screen } = await renderViewer({ initialIndex: 1, actions: [remove] });

    await fireEvent.press(screen.getByTestId('album-viewer-more'));
    await fireEvent.press(screen.getByTestId('album-viewer-action-remove'));
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.getByTestId('album-viewer-confirm')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('album-viewer-confirm-no'));
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.queryByTestId('album-viewer-confirm')).toBeNull();

    await fireEvent.press(screen.getByTestId('album-viewer-more'));
    await fireEvent.press(screen.getByTestId('album-viewer-action-remove'));
    await fireEvent.press(screen.getByTestId('album-viewer-confirm-yes'));
    expect(onRemove).toHaveBeenCalledWith(PHOTOS[1]);
    expect(screen.queryByTestId('album-viewer-confirm')).toBeNull();
  });

  it('after a removal shows the photo that took its place, and closes once the album is empty', async () => {
    const onClose = jest.fn();
    const screen = await render(<StoryViewer photos={PHOTOS} initialIndex={2} onClose={onClose} />);
    await screen.rerender(<StoryViewer photos={PHOTOS.slice(0, 2)} initialIndex={2} onClose={onClose} />);
    expect(screen.getByTestId('album-viewer-photo-p2')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    await screen.rerender(<StoryViewer photos={[]} initialIndex={2} onClose={onClose} />);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('an album that opens empty says so, stays open, and can offer a way to add photos', async () => {
    const onAdd = jest.fn();
    const { screen, onClose } = await renderViewer({
      photos: [],
      actions: [
        { key: 'edit', label: 'edit album', onPress: jest.fn() },
        { key: 'remove', label: 'remove this photo', needsPhoto: true, onPress: jest.fn() },
      ],
      emptyAction: { label: 'add photos', onPress: onAdd },
    });
    expect(screen.getByTestId('album-viewer-empty')).toHaveTextContent('no photos here yet.');
    await fireEvent.press(screen.getByTestId('album-viewer-empty-action'));
    expect(onAdd).toHaveBeenCalledTimes(1);
    // Nothing to remove on an empty album, but edit is still offered.
    await fireEvent.press(screen.getByTestId('album-viewer-more'));
    expect(screen.getByTestId('album-viewer-action-edit')).toBeTruthy();
    expect(screen.queryByTestId('album-viewer-action-remove')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('system', () => {
  it('prevents screen capture while open and allows it again on close', async () => {
    const { screen } = await renderViewer();
    expect(mockPrevent).toHaveBeenCalledWith('album-story-viewer');
    expect(mockAllow).not.toHaveBeenCalled();
    await screen.unmount();
    expect(mockAllow).toHaveBeenCalledWith('album-story-viewer');
  });

  it('never lets a screen capture failure escape', async () => {
    mockPrevent.mockImplementationOnce(() => Promise.reject(new Error('not available on web')));
    const { screen } = await renderViewer();
    expect(screen.getByTestId('album-viewer-stage')).toBeTruthy();
  });

  it('hardware back closes a confirm first, then the story', async () => {
    const handlers: Array<(event: never) => boolean | null | undefined> = [];
    const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      handlers.push(handler as (event: never) => boolean | null | undefined);
      return { remove: jest.fn() };
    });
    const { screen, onClose } = await renderViewer({
      actions: [{ key: 'remove', label: 'remove this photo', confirm: { title: 'remove this photo?', confirmLabel: 'remove' }, onPress: jest.fn() }],
    });
    await fireEvent.press(screen.getByTestId('album-viewer-more'));
    await fireEvent.press(screen.getByTestId('album-viewer-action-remove'));
    expect(screen.getByTestId('album-viewer-confirm')).toBeTruthy();

    let handled: boolean | null | undefined;
    await act(async () => {
      handled = handlers[handlers.length - 1](undefined as never);
    });
    expect(handled).toBe(true);
    expect(screen.queryByTestId('album-viewer-confirm')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      handlers[handlers.length - 1](undefined as never);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('loading and failure', () => {
  it('shows a quiet spinner until the photo loads', async () => {
    const { screen } = await renderViewer();
    expect(screen.getByTestId('album-viewer-loading')).toBeTruthy();
    await load(screen, 'p1');
    expect(screen.queryByTestId('album-viewer-loading')).toBeNull();
  });

  it('shows a spinner while the album or its URLs are still loading', async () => {
    const { screen } = await renderViewer({ photos: [], loading: true });
    expect(screen.getByTestId('album-viewer-loading')).toBeTruthy();
    expect(screen.queryByTestId('album-viewer-empty')).toBeNull();
    await screen.unmount();
    const again = await renderViewer({ photos: [{ id: 'p1', uri: null }], resolving: true });
    expect(again.screen.getByTestId('album-viewer-loading')).toBeTruthy();
  });

  it('re-signs once on its own when a photo fails, then offers try again', async () => {
    const onRetry = jest.fn().mockResolvedValue(undefined);
    const { screen } = await renderViewer({ onRetry });
    await act(async () => {
      fireEvent(screen.getByTestId('album-viewer-photo-p1'), 'error', { nativeEvent: {} });
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('album-viewer-failed')).toHaveTextContent(/didn.t load/);

    await act(async () => {
      fireEvent.press(screen.getByTestId('album-viewer-retry'));
    });
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('album-viewer-failed')).toBeNull();
    expect(screen.getByTestId('album-viewer-photo-p1')).toBeTruthy();
  });

  it('a photo with no URL once signing has finished shows the failure', async () => {
    const { screen } = await renderViewer({ photos: [{ id: 'p1', uri: null }] });
    expect(screen.getByTestId('album-viewer-failed')).toBeTruthy();
    expect(screen.getByTestId('album-viewer-retry').props.accessibilityLabel).toBe('try again');
  });
});

describe('accessibility', () => {
  it('the photo area is one adjustable element announcing its position, with next and previous', async () => {
    const { screen } = await renderViewer({ initialIndex: 1 });
    const stage = screen.getByTestId('album-viewer-stage');
    expect(stage.props.accessible).toBe(true);
    expect(stage.props.accessibilityRole).toBe('adjustable');
    expect(stage.props.accessibilityLabel).toBe('photo 2 of 3');
    expect(stage.props.accessibilityActions).toEqual([
      { name: 'increment', label: 'next photo' },
      { name: 'decrement', label: 'previous photo' },
      { name: 'activate', label: 'next photo' },
    ]);
  });

  it('increment and decrement move and announce, increment never closes, decrement never restarts', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const { screen, onClose } = await renderViewer({ initialIndex: 1 });
    const act11y = (actionName: string) =>
      fireEvent(screen.getByTestId('album-viewer-stage'), 'accessibilityAction', { nativeEvent: { actionName } });
    await act11y('increment');
    expect(stageLabel(screen)).toBe('photo 3 of 3');
    expect(announce).toHaveBeenLastCalledWith('photo 3 of 3');
    await act11y('increment');
    expect(onClose).not.toHaveBeenCalled();
    await act11y('decrement');
    await act11y('decrement');
    expect(stageLabel(screen)).toBe('photo 1 of 3');
    await act11y('decrement');
    expect(stageLabel(screen)).toBe('photo 1 of 3');
  });

  it('the bars are hidden from screen readers and the tap zones are not separate elements', async () => {
    const { screen } = await renderViewer();
    const bars = screen.getByTestId('album-viewer-bars', { includeHiddenElements: true });
    expect(bars.props.accessibilityElementsHidden).toBe(true);
    expect(bars.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(screen.getByTestId('album-viewer-back-zone').props.accessible).toBe(false);
    expect(screen.getByTestId('album-viewer-forward-zone').props.accessible).toBe(false);
  });

  it('never says the banned word for the drag gesture', async () => {
    const { screen } = await renderViewer({
      owner: OWNER,
      reply: { onSend: jest.fn() },
      actions: [{ key: 'remove', label: 'remove this photo', onPress: jest.fn() }],
    });
    expect(screen.queryByLabelText(/swipe/i)).toBeNull();
    expect(screen.queryByText(/swipe/i)).toBeNull();
  });
});
