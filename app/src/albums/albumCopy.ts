import type { StoryConfirm } from './StoryViewer';

/**
 * Copy shared by the story's `…` sheet and the edit grid. Removing a photo
 * is permanent (the row and then the stored object go, `api/albums.ts`
 * `removeAlbumPhoto`), so both ask first with the same words.
 */
export const REMOVE_PHOTO_CONFIRM: StoryConfirm = {
  title: 'remove this photo?',
  body: "it's gone for good, for you and for anyone this album is shared with.",
  confirmLabel: 'remove',
  cancelLabel: 'keep it',
};

/** The same question for the album's video: the row, the video and its poster all go. */
export const REMOVE_VIDEO_CONFIRM: StoryConfirm = {
  title: 'remove this video?',
  body: "it's gone for good, for you and for anyone this album is shared with.",
  confirmLabel: 'remove',
  cancelLabel: 'keep it',
};

export const REMOVE_PHOTO_LABEL = 'remove this photo';
export const REMOVE_VIDEO_LABEL = 'remove this video';
export const REMOVE_VIDEO_FAILED = "couldn't remove that video. try again.";

/** The owner's ruling (2026-09-30): "albums are for pictures and one video only". Said where photos are added. */
export const ALBUM_HOLDS_NOTE = 'an album holds photos and one video.';

/** Under `add photos` once the album has its video: the picker then offers photos only. */
export const VIDEO_SLOT_TAKEN_NOTE = 'this album has its one video. to add a different one, remove it first.';

/** A second video, from the picker or refused by the server. */
export const ONE_VIDEO_LINE = 'this album holds one video. remove the one in it first to add another.';

/** A video refused before upload. Same limits as chat (`chat/video.ts`), worded for an album. */
export const ALBUM_VIDEO_REJECTION_COPY = {
  duration: 'that video is too long for an album. try one under 30 seconds.',
  size: 'that video is too big for an album. try a shorter one.',
  unreadable: "couldn't read that video. try another one.",
} as const;

/** While a batch uploads: `adding 2 of 5`. */
export function addingProgressLine(current: number, total: number): string {
  return total > 1 ? `adding ${current} of ${total}` : 'adding';
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/**
 * Which picks of a batch didn't upload, by their place in the selection:
 * `the 3rd one didn't upload. try it again.` When the batch was one item,
 * just `that one didn't upload. try it again.`
 */
export function batchFailureLine(positions: number[], total: number): string {
  if (positions.length === 0) return '';
  if (total <= 1) return "that one didn't upload. try it again.";
  const sorted = [...positions].sort((a, b) => a - b);
  if (sorted.length === 1) return `the ${ordinal(sorted[0])} one didn't upload. try it again.`;
  if (sorted.length === total) return "none of them uploaded. try again.";
  return `the ${joinWords(sorted.map(ordinal))} didn't upload. try them again.`;
}

/** An album's count, over its cover: `3 photos`, `3 photos · 1 video`, `1 video`, `empty`. */
export function albumCountLabel(photos: number, videos: number): string {
  const parts: string[] = [];
  if (photos > 0) parts.push(`${photos} photo${photos === 1 ? '' : 's'}`);
  if (videos > 0) parts.push(`${videos} video${videos === 1 ? '' : 's'}`);
  return parts.length > 0 ? parts.join(' · ') : 'empty';
}
export const EDIT_ALBUM_LABEL = 'edit album';
export const ADD_PHOTOS_LABEL = 'add photos';
export const REMOVE_PHOTO_FAILED = "couldn't remove that photo. try again.";
export const ALBUM_DIDNT_LOAD = "this album didn't load.";
