import { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';

type ExpoVideo = typeof import('expo-video');

/**
 * `expo-video`, loaded the first time a video is actually on screen rather
 * at import. Every screen that shows an album story imports `StoryViewer`,
 * and `expo-video` cannot load under Jest without a mock; a photo-only
 * story (and every existing test of one) never needs it. A plain `require`,
 * not a dynamic `import()`, which this project's Jest config can't run
 * (`chat/video.ts`'s header). Metro bundles it either way.
 */
let expoVideo: ExpoVideo | null = null;
function loadExpoVideo(): ExpoVideo {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  if (!expoVideo) expoVideo = require('expo-video') as ExpoVideo;
  return expoVideo;
}

export interface StoryVideoProps {
  /** A signed URL for the video. The component is keyed on it by the story, so a new URL is a new player. */
  uri: string;
  /** Plays while the story's timer runs, pauses whenever it is held (a finger down, the reply field, a sheet, the background). */
  playing: boolean;
  /** Changes when the story restarts this item (tap back on the first one): back to the start. */
  restartKey: string | number;
  /** The video can play: the story counts it as loaded and starts its clock. */
  onReady: () => void;
  /** The video could not load (an expired URL, a network failure). */
  onError: () => void;
  testID?: string;
}

/**
 * The album's one video, inside the story (`StoryViewer`). The same
 * `expo-video` player the chat media viewer uses
 * (`app/chat/[id]/media/[messageId].tsx`'s `ViewerVideo`: `useVideoPlayer`
 * plus `VideoView`), set up for a story rather than a viewer: no native
 * controls (taps move the story), cover-fit like the photos, not looping,
 * with sound. The story, not the player, decides when to move on: its timer
 * runs for the video's stored length (`album_photos.media_duration_ms`).
 *
 * Split out so `useVideoPlayer` is only ever called with a real URI, never
 * conditionally.
 */
export function StoryVideo({ uri, playing, restartKey, onReady, onError, testID }: StoryVideoProps) {
  // The same module every render, so the hook order never changes.
  const { useVideoPlayer, VideoView } = loadExpoVideo();
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
  });

  const handlers = useRef({ onReady, onError });
  handlers.current = { onReady, onError };

  useEffect(() => {
    const report = (status: string | undefined) => {
      if (status === 'readyToPlay') handlers.current.onReady();
      else if (status === 'error') handlers.current.onError();
    };
    report(player.status);
    const subscription = player.addListener?.('statusChange', (payload: { status?: string }) => report(payload?.status));
    return () => subscription?.remove?.();
  }, [player]);

  useEffect(() => {
    try {
      if (playing) player.play();
      else player.pause();
    } catch {
      // A released player (the story moved on mid-render) has nothing to play.
    }
  }, [player, playing]);

  const lastRestart = useRef(restartKey);
  useEffect(() => {
    if (lastRestart.current === restartKey) return;
    lastRestart.current = restartKey;
    try {
      player.currentTime = 0;
    } catch {
      // Same as above.
    }
  }, [player, restartKey]);

  return (
    <VideoView
      player={player}
      style={styles.fill}
      contentFit="cover"
      nativeControls={false}
      accessible={false}
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
});
