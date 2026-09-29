/**
 * `MediaPreview`'s frame (the "send a photo/video" step): it shows the actual
 * image (or the video's poster frame) at its real aspect ratio, contained,
 * and never hands `Image` something it can't draw (a video file, an empty
 * URI) — which is what rendered the broken frame before.
 */
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { MediaPreview, previewSourceUri, type MediaPreviewAsset } from '../chat/MediaPreview';

function flat(style: unknown): Record<string, unknown> {
  return StyleSheet.flatten(style as never) ?? {};
}

async function renderPreview(asset: MediaPreviewAsset) {
  return render(
    <MediaPreview visible asset={asset} sending={false} onDismiss={jest.fn()} onSend={jest.fn()} />
  );
}

describe('previewSourceUri', () => {
  it('uses the photo itself for a photo', () => {
    expect(previewSourceUri({ kind: 'photo', uri: 'file:///a.jpg' })).toBe('file:///a.jpg');
  });

  it('uses only the poster for a video — never the video file', () => {
    expect(previewSourceUri({ kind: 'video', uri: 'file:///a.mp4', posterUri: 'file:///p.jpg' })).toBe('file:///p.jpg');
    expect(previewSourceUri({ kind: 'video', uri: 'file:///a.mp4', posterUri: null })).toBeNull();
  });

  it('treats an empty uri (tray URL not signed yet) as nothing to draw', () => {
    expect(previewSourceUri({ kind: 'photo', uri: '' })).toBeNull();
  });
});

describe('MediaPreview frame', () => {
  it('draws the picked photo, contained, in a frame with the photo’s own aspect ratio', async () => {
    const screen = await renderPreview({ kind: 'photo', uri: 'file:///a.jpg', width: 3000, height: 4000 });

    const image = screen.getByTestId('media-preview-image');
    expect(image.props.source).toEqual({ uri: 'file:///a.jpg' });
    expect(image.props.resizeMode).toBe('contain');

    const box = flat(screen.getByTestId('media-preview-box').props.style);
    expect((box.width as number) / (box.height as number)).toBeCloseTo(3 / 4, 1);
    expect(box.height as number).toBeLessThanOrEqual(360);
  });

  it('re-fits to the image’s real size once it loads', async () => {
    const screen = await renderPreview({ kind: 'photo', uri: 'file:///a.jpg' });
    await fireEvent(screen.getByTestId('media-preview-image'), 'load', {
      nativeEvent: { source: { width: 2000, height: 1000, uri: 'file:///a.jpg' } },
    });
    const box = flat(screen.getByTestId('media-preview-box').props.style);
    expect((box.width as number) / (box.height as number)).toBeCloseTo(2, 1);
  });

  it('shows a video’s poster frame with the play badge', async () => {
    const screen = await renderPreview({
      kind: 'video',
      uri: 'file:///clip.mp4',
      posterUri: 'file:///poster.jpg',
      width: 1920,
      height: 1080,
    });
    expect(screen.getByTestId('media-preview-image').props.source).toEqual({ uri: 'file:///poster.jpg' });
    expect(screen.getByTestId('media-preview-play-overlay')).toBeTruthy();
  });

  it('falls back to a placeholder, not a broken image, when a video has no poster', async () => {
    const screen = await renderPreview({ kind: 'video', uri: 'file:///clip.mp4', posterUri: null });
    expect(screen.queryByTestId('media-preview-image')).toBeNull();
    expect(screen.getByTestId('media-preview-placeholder')).toBeTruthy();
    expect(screen.getByTestId('media-preview-play-overlay')).toBeTruthy();
  });

  it('falls back to a placeholder when the image fails to load', async () => {
    const screen = await renderPreview({ kind: 'photo', uri: 'https://signed/expired.jpg' });
    await fireEvent(screen.getByTestId('media-preview-image'), 'error', { nativeEvent: {} });
    expect(screen.getByTestId('media-preview-placeholder')).toBeTruthy();
  });

  it('still defaults to keep in chat', async () => {
    const onSend = jest.fn();
    const screen = await render(
      <MediaPreview
        visible
        asset={{ kind: 'photo', uri: 'file:///a.jpg' }}
        sending={false}
        onDismiss={jest.fn()}
        onSend={onSend}
      />
    );
    fireEvent.press(screen.getByTestId('media-preview-send'));
    expect(onSend).toHaveBeenCalledWith(null);
  });
});
