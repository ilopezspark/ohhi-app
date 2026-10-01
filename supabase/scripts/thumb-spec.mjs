// The thumbnail spec (docs/thumbnails.md, migration 0027), shared by
// supabase/scripts/backfill-thumbnails.mjs and supabase/seed/demo/upload.mjs.
// The app's own generator must produce the same thing.

export const THUMB_LONG_EDGE = 480;
export const THUMB_QUALITY = 70;

/** Buckets that get thumbnails. Never chat-media-limited (decision 62: no second copy). */
export const THUMB_BUCKETS = ["profile-photos", "album-photos", "chat-media"];

/** {dir}/{stem}.jpg -> {dir}/{stem}.thumb.jpg (a poster {x}-poster.jpg -> {x}-poster.thumb.jpg). */
export const thumbPathFor = (path) => path.replace(/\.jpg$/, ".thumb.jpg");

/** Whether an object at `path` in `bucket` should have a thumbnail. */
export const wantsThumb = (bucket, path) =>
  THUMB_BUCKETS.includes(bucket) && path.endsWith(".jpg") && !path.endsWith(".thumb.jpg");

/**
 * JPEG, 480px long edge, quality 70, never enlarged, EXIF orientation applied, no metadata
 * (sharp writes none unless asked). `sharp` is passed in so callers resolve it from
 * app/node_modules themselves.
 */
export function makeThumb(sharp, input) {
  return sharp(input, { failOn: "none" })
    .rotate()
    .resize({ width: THUMB_LONG_EDGE, height: THUMB_LONG_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
    .toBuffer();
}
