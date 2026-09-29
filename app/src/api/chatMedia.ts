import { supabase } from './client';
import { mapSupabaseError } from './errors';
import { resizeForUpload } from '../photos/resize';
import { readUploadBody, type UploadBody } from '../storage/readUpload';
import { logUploadFailure } from '../storage/uploadError';
import { MAX_VIDEO_BYTES } from '../chat/video';

export const CHAT_MEDIA_BUCKET = 'chat-media';
/**
 * `docs/chat-media-plan.md` §2 (decision CM-1): view-once/view-twice media.
 * No select policy at all — the only read path is the `media-open` edge
 * function's signed URL. Never call `signedChatMediaUrls`/`createSignedUrls`
 * against this bucket from the client; it will simply fail to sign, which is
 * the point.
 */
export const CHAT_MEDIA_LIMITED_BUCKET = 'chat-media-limited';

export type ChatMediaKind = 'photo' | 'video';

/**
 * The exact path both `chat-media` and `chat-media-limited`'s storage
 * policies parse: `{conversation_id}/{message_id}.jpg` (photo) or `.mp4`
 * (video, §6).
 *
 * Both policies take `(storage.foldername(name))[1]`, require it to match a
 * uuid regex, and then cast it — read via `can_read_conversation` (`chat-
 * media` only — `chat-media-limited` has no select policy at all), write via
 * "the conversation is `open` and I'm a participant". So the first segment
 * must be the conversation id, lowercase-hex uuid, nothing else; the second
 * segment is unparsed by the policies but is the message id so the object and
 * the row that points at it share one name.
 */
export function chatMediaPath(conversationId: string, messageId: string, kind: ChatMediaKind = 'photo'): string {
  return `${conversationId}/${messageId}.${kind === 'video' ? 'mp4' : 'jpg'}`;
}

/** `{conversation_id}/{message_id}-poster.jpg` — same bucket as the video itself (§6). */
export function chatMediaPosterPath(conversationId: string, messageId: string): string {
  return `${conversationId}/${messageId}-poster.jpg`;
}

export interface UploadChatMediaInput {
  conversationId: string;
  /** Pre-minted message id (see `chat/uuid.ts`) — the row does not exist yet. */
  messageId: string;
  /** Local file URI from `expo-image-picker`. */
  uri: string;
  width: number;
  height: number;
  kind?: ChatMediaKind;
  /** `null`/omitted = keep in chat (`chat-media`); `1`/`2` = `chat-media-limited` (§2). */
  bucket?: typeof CHAT_MEDIA_BUCKET | typeof CHAT_MEDIA_LIMITED_BUCKET;
}

/**
 * Resize -> upload -> return the path to store in `messages.media_path`.
 *
 * **Upload first, insert second** (plan §3). The storage write policy checks
 * the conversation's `state = 'open'` and participancy, not the existence of
 * the message row, so the object can be written before the row — and it has to
 * be, because `messages` has no client update grant, which rules out
 * "insert the row, then patch `media_path` in".
 *
 * That ordering leaks an object whenever the upload succeeds and the insert
 * then fails (a race against a block, an expiry, or plain network loss).
 * **Decision 37 accepts that leak for v1**: no cleanup path exists — the
 * bucket is private, `storage.objects` has no delete policy for `chat-media`,
 * and the client could not remove it even if it wanted to. It is swept later
 * by extending the existing purge-queue infrastructure to an orphan sweep.
 * Nothing here retries or compensates; the caller just rolls its optimistic
 * bubble back. The same leak class now also exists in `chat-media-limited` —
 * §7's "no new leak class, just a second bucket it can happen in".
 *
 * One consequence worth naming: for the blocked party in a shadow-accepted
 * `closed_block` thread (decision 12) the *upload* already fails, because the
 * write policy requires `state = 'open'`. `composerState` deliberately leaves
 * the attach button enabled there — a disabled one would be the tell — so this
 * failure surfaces as the same generic "couldn't send" as a dropped network,
 * and not one object is leaked in that case.
 *
 * Photos go through the shared `photos/resize.ts` first, which is also the
 * EXIF-stripping step (it re-encodes rather than copying the source file), so
 * chat media carries no GPS or device metadata either. Video is uploaded
 * as-is (§6: no client-side re-encode) — its own EXIF/metadata posture is
 * unchanged from the source file, a known gap the plan does not close.
 */
export async function uploadChatMedia({
  conversationId,
  messageId,
  uri,
  width,
  height,
  kind = 'photo',
  bucket = CHAT_MEDIA_BUCKET,
}: UploadChatMediaInput): Promise<string> {
  const path = chatMediaPath(conversationId, messageId, kind);

  let uploadUri = uri;
  let contentType = kind === 'video' ? 'video/mp4' : 'image/jpeg';
  if (kind === 'photo') {
    const resized = await resizeForUpload({ uri, width, height });
    uploadUri = resized.uri;
    contentType = 'image/jpeg';
  }

  // Video is uploaded as-is, so it is also where the 50 MB cap matters: a
  // picker that didn't report `fileSize` is still stopped here, before the
  // file is read into memory.
  let body: UploadBody;
  try {
    body = await readUploadBody(uploadUri, kind === 'video' ? { maxBytes: MAX_VIDEO_BYTES } : {});
  } catch (error) {
    logUploadFailure({ what: 'chat media', step: 'read', bucket, path }, error);
    throw error;
  }

  const { error } = await supabase.storage.from(bucket).upload(path, body, {
    contentType,
    // No upsert: one object per message id, and a message row is never edited.
    upsert: false,
  });
  if (error) {
    logUploadFailure({ what: 'chat media', step: 'upload', bucket, path }, error);
    throw mapSupabaseError(error);
  }

  return path;
}

export interface UploadChatMediaPosterInput {
  conversationId: string;
  messageId: string;
  /** Local file URI of the generated poster frame (`chat/video.ts#generateVideoPoster`). */
  uri: string;
  bucket?: typeof CHAT_MEDIA_BUCKET | typeof CHAT_MEDIA_LIMITED_BUCKET;
}

/** Uploads a video's poster frame, same bucket as the video, `-poster.jpg` suffix (§6). */
export async function uploadChatMediaPoster({
  conversationId,
  messageId,
  uri,
  bucket = CHAT_MEDIA_BUCKET,
}: UploadChatMediaPosterInput): Promise<string> {
  const path = chatMediaPosterPath(conversationId, messageId);

  let body: UploadBody;
  try {
    body = await readUploadBody(uri);
  } catch (error) {
    logUploadFailure({ what: 'chat media poster', step: 'read', bucket, path }, error);
    throw error;
  }

  const { error } = await supabase.storage.from(bucket).upload(path, body, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (error) {
    logUploadFailure({ what: 'chat media poster', step: 'poster', bucket, path }, error);
    throw mapSupabaseError(error);
  }

  return path;
}

/**
 * Signed URLs for `messages.media_path` values, 60s, re-signed per fetch —
 * same policy as profile photos (architecture plan §7). The bucket is private
 * and the read policy re-evaluates `can_read_conversation` at sign time, so a
 * path that stops qualifying simply fails to sign. A failure is therefore
 * "render the placeholder", never an error state and never an explanation.
 *
 * **`chat-media` only** — `chat-media-limited` has no select policy at all
 * (CM-1), so this must never be called against it; the viewer reads limited
 * media exclusively through `api/mediaOpen.ts`.
 */
export async function signedChatMediaUrls(paths: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter((path) => !!path)));
  if (unique.length === 0) return {};

  const { data, error } = await supabase.storage
    .from(CHAT_MEDIA_BUCKET)
    .createSignedUrls(unique, 60);
  if (error || !data) return {};

  const urls: Record<string, string> = {};
  for (const entry of data) {
    if (entry.signedUrl && entry.path) urls[entry.path] = entry.signedUrl;
  }
  return urls;
}

export interface ResendChatMediaInput {
  /** Source object's path, always in `chat-media` — the tray only ever surfaces keep-in-chat items (§5). */
  sourcePath: string;
  sourcePosterPath?: string | null;
  targetConversationId: string;
  targetMessageId: string;
  kind: ChatMediaKind;
  /** `null` = keep in chat (`chat-media`), `1`/`2` = `chat-media-limited`. */
  viewLimit: 1 | 2 | null;
}

export interface ResendChatMediaResult {
  mediaPath: string;
  posterPath: string | null;
}

/**
 * Re-sending from the recently-shared tray (§5, decision 59/CM-2): gives the
 * new message its own independently-owned object rather than pointing at the
 * original path, so every bucket read policy's "path segment 1 is the owning
 * conversation" assumption stays intact.
 *
 * Decision 59 (amended 28 September 2026) settled on exactly this client-side
 * shape rather than a service-role storage-to-storage `copy` op: sign the
 * source (60s, `chat-media` only, which the tray's own `view_limit is null`
 * scoping guarantees is readable), fetch the bytes, and upload them to the
 * target path/bucket. Same outcome as a server-side copy — a new object at
 * the target conversation's path, the original untouched — without adding a
 * service-role copy function; the cost is a client-side re-read of the bytes
 * on every resend.
 */
export async function resendChatMedia({
  sourcePath,
  sourcePosterPath,
  targetConversationId,
  targetMessageId,
  kind,
  viewLimit,
}: ResendChatMediaInput): Promise<ResendChatMediaResult> {
  const targetBucket = viewLimit == null ? CHAT_MEDIA_BUCKET : CHAT_MEDIA_LIMITED_BUCKET;
  const paths = sourcePosterPath ? [sourcePath, sourcePosterPath] : [sourcePath];

  const { data: signed, error: signError } = await supabase.storage
    .from(CHAT_MEDIA_BUCKET)
    .createSignedUrls(paths, 60);
  if (signError || !signed) throw mapSupabaseError(signError ?? new Error('could not sign source media'));

  const urlByPath: Record<string, string> = {};
  for (const entry of signed) {
    if (entry.signedUrl && entry.path) urlByPath[entry.path] = entry.signedUrl;
  }
  const mediaUrl = urlByPath[sourcePath];
  if (!mediaUrl) throw mapSupabaseError(new Error('source media no longer readable'));

  const mediaBody = await readUploadBody(mediaUrl, kind === 'video' ? { maxBytes: MAX_VIDEO_BYTES } : {});
  const targetMediaPath = chatMediaPath(targetConversationId, targetMessageId, kind);
  const { error: uploadError } = await supabase.storage.from(targetBucket).upload(targetMediaPath, mediaBody, {
    contentType: kind === 'video' ? 'video/mp4' : 'image/jpeg',
    upsert: false,
  });
  if (uploadError) {
    logUploadFailure({ what: 'chat media resend', step: 'upload', bucket: targetBucket, path: targetMediaPath }, uploadError);
    throw mapSupabaseError(uploadError);
  }

  let targetPosterPath: string | null = null;
  const posterUrl = sourcePosterPath ? urlByPath[sourcePosterPath] : undefined;
  if (posterUrl) {
    const posterBody = await readUploadBody(posterUrl);
    targetPosterPath = chatMediaPosterPath(targetConversationId, targetMessageId);
    const { error: posterError } = await supabase.storage.from(targetBucket).upload(targetPosterPath, posterBody, {
      contentType: 'image/jpeg',
      upsert: false,
    });
    if (posterError) {
      logUploadFailure({ what: 'chat media resend', step: 'poster', bucket: targetBucket, path: targetPosterPath }, posterError);
      throw mapSupabaseError(posterError);
    }
  }

  return { mediaPath: targetMediaPath, posterPath: targetPosterPath };
}
