/**
 * The story-style album viewer (`albums/StoryViewer.tsx`): tap zones and
 * their boundaries, close on the last photo, the start index, hold to hide
 * the chrome, owner vs recipient controls, load/failure states, prefetch,
 * screenshot prevention and the accessibility surface.
 */
import { act, fireEvent, render } from '@testing-library/react-native';
import { AccessibilityInfo, BackHandler, Image } from 'react-native';

const mockPrevent = jest.fn((_key?: string) => Promise.resolve());
const mockAllow = jest.fn((_key?: string) => Promise.resolve());
jest.mock('expo-screen-capture', () => ({
  preventScreenCaptureAsync: (key: string) => mockPrevent(key),
  allowScreenCaptureAsync: (key: string) => mockAllow(key),
}));

import { StoryViewer, type StoryPhoto, type StoryViewerProps } from '../albums/StoryViewer';

const PHOTOS: StoryPhoto[] = [
  { id: 'p1', uri: 'https://example.test/p1.jpg?token=1' },
  { id: 'p2', uri: 'https://example.test/p2.jpg?token=1' },
  { id: 'p3', uri: 'https://example.test/p3.jpg?token=1' },
];

let prefetchSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  prefetchSpy = jest.spyOn(Image, 'prefetch').mockResolvedValue(true);
});

afterEach(() => {
  prefetchSpy.mockRestore();
});

async function renderViewer(overrides: Partial<StoryViewerProps> = {}) {
  const onClose = jest.fn();
  const props: StoryViewerProps = { photos: PHOTOS, title: 'summer', onClose, ...overrides };
  const screen = await render(<StoryViewer {...props} />);
  return { screen, onClose: props.onClose as jest.Mock };
}

function stageLabel(screen: Awaited<ReturnType<typeof renderViewer>>['screen']) {
  return screen.getByTestId('album-viewer-stage').props.accessibilityLabel;
}

describe('tap zones', () => {
  it('opens at the first photo by default, with its bar filled', async () => {
    const { screen } = await renderViewer();
    expect(screen.getByTestId('album-viewer-photo-p1')).toBeTruthy();
    expect(stageLabel(screen)).toBe('photo 1 of 3');
    expect(screen.getByTestId('album-viewer-bar-0', { includeHiddenElements: true })).toHaveStyle({ backgroundColor: 'rgba(255, 255, 255, 0.95)' });
    expect(screen.getByTestId('album-viewer-bar-1', { includeHiddenElements: true })).toHaveStyle({ backgroundColor: 'rgba(255, 255, 255, 0.35)' });
  });

  it('the right zone advances, the left zone goes back', async () => {
    const { screen } = await renderViewer();
    await fireEvent.press(screen.getByTestId('album-viewer-forward-zone'));
    expect(screen.getByTestId('album-viewer-photo-p2')).toBeTruthy();
    expect(screen.getByTestId('album-viewer-bar-1', { includeHiddenElements: true })).toHaveStyle({ backgroundColor: 'rgba(255, 255, 255, 0.95)' });
    await fireEvent.press(screen.getByTestId('album-viewer-back-zone'));
    expect(screen.getByTestId('album-viewer-photo-p1')).toBeTruthy();
  });

  it('the zones split a third back and two thirds forward', async () => {
    const { screen } = await renderViewer();
    expect(screen.getByTestId('album-viewer-back-zone')).toHaveStyle({ flex: 1 });
    expect(screen.getByTestId('album-viewer-forward-zone')).toHaveStyle({ flex: 2 });
  });

  it('going back on the first photo does nothing', async () => {
    const { screen, onClose } = await renderViewer();
    await fireEvent.press(screen.getByTestId('album-viewer-back-zone'));
    expect(screen.getByTestId('album-viewer-photo-p1')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('advancing past the last photo closes the viewer', async () => {
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

  it('prefetches the next photo', async () => {
    const { screen } = await renderViewer();
    expect(prefetchSpy).toHaveBeenCalledWith(PHOTOS[1].uri);
    await fireEvent.press(screen.getByTestId('album-viewer-forward-zone'));
    expect(prefetchSpy).toHaveBeenCalledWith(PHOTOS[2].uri);
  });
});

describe('hold to hide', () => {
  it('hides the bars, title and buttons while held and brings them back on release', async () => {
    const { screen } = await renderViewer({ ownerName: 'maya' });
    expect(screen.getByTestId('album-viewer-chrome')).toBeTruthy();
    await fireEvent(screen.getByTestId('album-viewer-forward-zone'), 'longPress');
    expect(screen.queryByTestId('album-viewer-chrome')).toBeNull();
    expect(screen.queryByTestId('album-viewer-close')).toBeNull();
    expect(screen.queryByTestId('album-viewer-owner')).toBeNull();
    await fireEvent(screen.getByTestId('album-viewer-forward-zone'), 'pressOut');
    expect(screen.getByTestId('album-viewer-chrome')).toBeTruthy();
    // A hold is not a tap: still on the first photo.
    expect(stageLabel(screen)).toBe('photo 1 of 3');
  });
});

describe('top row and controls', () => {
  it('shows the album title and the owner name for a recipient, with a close button', async () => {
    const { screen, onClose } = await renderViewer({ ownerName: 'maya' });
    expect(screen.getByTestId('album-viewer-title')).toHaveTextContent('summer');
    expect(screen.getByTestId('album-viewer-owner')).toHaveTextContent('maya');
    expect(screen.queryByTestId('album-viewer-more')).toBeNull();
    await fireEvent.press(screen.getByTestId('album-viewer-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('offers no save, download or share-out action', async () => {
    const { screen } = await renderViewer({ ownerName: 'maya' });
    expect(screen.queryByText(/save|download|share/i)).toBeNull();
  });

  it('gives the owner a … sheet that removes the photo on screen', async () => {
    const onRemove = jest.fn();
    const { screen } = await renderViewer({
      initialIndex: 1,
      actions: [{ key: 'remove', label: 'remove this photo', destructive: true, onPress: onRemove }],
    });
    await fireEvent.press(screen.getByTestId('album-viewer-more'));
    expect(screen.getByTestId('album-viewer-menu')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('album-viewer-action-remove'));
    expect(onRemove).toHaveBeenCalledWith(PHOTOS[1]);
    expect(screen.queryByTestId('album-viewer-menu')).toBeNull();
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

  it('an album that opens empty says so and stays open', async () => {
    const { screen, onClose } = await renderViewer({ photos: [] });
    expect(screen.getByTestId('album-viewer-empty')).toHaveTextContent('no photos here yet.');
    expect(onClose).not.toHaveBeenCalled();
  });

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

  it('hardware back closes', async () => {
    const handlers: Array<(event: never) => boolean | null | undefined> = [];
    const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      handlers.push(handler as (event: never) => boolean | null | undefined);
      return { remove: jest.fn() };
    });
    const { onClose } = await renderViewer();
    let handled: boolean | null | undefined;
    await act(async () => {
      handled = handlers[handlers.length - 1](undefined as never);
    });
    expect(handled).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('loading and failure', () => {
  it('shows a quiet spinner until the photo loads', async () => {
    const { screen } = await renderViewer();
    expect(screen.getByTestId('album-viewer-loading')).toBeTruthy();
    await fireEvent(screen.getByTestId('album-viewer-photo-p1'), 'load');
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
      fireEvent(screen.getByTestId('album-viewer-photo-p1'), 'error');
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    // Same URL came back: this time it says so.
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
  it('the photo area is one adjustable element announcing its position', async () => {
    const { screen } = await renderViewer({ initialIndex: 1 });
    const stage = screen.getByTestId('album-viewer-stage');
    expect(stage.props.accessible).toBe(true);
    expect(stage.props.accessibilityRole).toBe('adjustable');
    expect(stage.props.accessibilityLabel).toBe('photo 2 of 3');
    expect(stage.props.accessibilityActions.map((a: { name: string }) => a.name)).toEqual([
      'increment',
      'decrement',
      'activate',
    ]);
  });

  it('increment and decrement move and announce, and increment never closes', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const { screen, onClose } = await renderViewer({ initialIndex: 1 });
    await fireEvent(screen.getByTestId('album-viewer-stage'), 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    });
    expect(stageLabel(screen)).toBe('photo 3 of 3');
    expect(announce).toHaveBeenLastCalledWith('photo 3 of 3');
    await fireEvent(screen.getByTestId('album-viewer-stage'), 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    });
    expect(onClose).not.toHaveBeenCalled();
    await fireEvent(screen.getByTestId('album-viewer-stage'), 'accessibilityAction', {
      nativeEvent: { actionName: 'decrement' },
    });
    expect(stageLabel(screen)).toBe('photo 2 of 3');
  });

  it('the bars are hidden from screen readers, the tap zones are not separate elements, close is labelled', async () => {
    const { screen } = await renderViewer();
    const bars = screen.getByTestId('album-viewer-bars', { includeHiddenElements: true });
    expect(bars.props.accessibilityElementsHidden).toBe(true);
    expect(bars.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(screen.getByTestId('album-viewer-back-zone').props.accessible).toBe(false);
    expect(screen.getByTestId('album-viewer-forward-zone').props.accessible).toBe(false);
    expect(screen.getByTestId('album-viewer-close').props.accessibilityLabel).toBe('close');
  });

  it('never says the banned word for the drag gesture', async () => {
    const { screen } = await renderViewer({ actions: [{ key: 'remove', label: 'remove this photo', onPress: jest.fn() }] });
    expect(screen.queryByLabelText(/swipe/i)).toBeNull();
    expect(screen.queryByText(/swipe/i)).toBeNull();
  });
});
