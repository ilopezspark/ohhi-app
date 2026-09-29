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

export const REMOVE_PHOTO_LABEL = 'remove this photo';
export const EDIT_ALBUM_LABEL = 'edit album';
export const ADD_PHOTOS_LABEL = 'add photos';
export const REMOVE_PHOTO_FAILED = "couldn't remove that photo. try again.";
export const ALBUM_DIDNT_LOAD = "this album didn't load.";
