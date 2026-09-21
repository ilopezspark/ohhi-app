import { supabase } from './client';
import { mapSupabaseError } from './errors';
import { resizeForUpload } from '../photos/resize';

export const CHAT_MEDIA_BUCKET = 'chat-media';

/**
 * The exact path the `chat-media` storage policies parse:
 * `{conversation_id}/{message_id}.jpg`.
 *
 * Both policies take `(storage.foldername(name))[1]`, require it to match a
 * uuid regex, and then cast it — read via `can_read_conversation`, write via
 * "the conversation is `open` and I'm a participant". So the first segment
 * must be the conversation id, lowercase-hex uuid, nothing else; the second
 * segment is unparsed by the policies but is the message id so the object and
 * the row that points at it share one name.
 */
export function chatMediaPath(conversationId: string, messageId: string): string {
  return `${conversationId}/${messageId}.jpg`;
}

export interface UploadChatMediaInput {
  conversationId: string;
  /** Pre-minted message id (see `chat/uuid.ts`) — the row does not exist yet. */
  messageId: string;
  /** Local file URI from `expo-image-picker`. */
  uri: string;
  width: number;
  height: number;
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
 * bubble back.
 *
 * One consequence worth naming: for the blocked party in a shadow-accepted
 * `closed_block` thread (decision 12) the *upload* already fails, because the
 * write policy requires `state = 'open'`. `composerState` deliberately leaves
 * the attach button enabled there — a disabled one would be the tell — so this
 * failure surfaces as the same generic "couldn't send" as a dropped network,
 * and not one object is leaked in that case.
 *
 * Resize goes through the shared `photos/resize.ts`, which is also the
 * EXIF-stripping step (it re-encodes rather than copying the source file), so
 * chat media carries no GPS or device metadata either.
 */
export async function uploadChatMedia({
  conversationId,
  messageId,
  uri,
  width,
  height,
}: UploadChatMediaInput): Promise<string> {
  const resized = await resizeForUpload({ uri, width, height });
  const path = chatMediaPath(conversationId, messageId);

  const response = await fetch(resized.uri);
  const blob = await response.blob();

  const { error } = await supabase.storage.from(CHAT_MEDIA_BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    // No upsert: one object per message id, and a message row is never edited.
    upsert: false,
  });
  if (error) throw mapSupabaseError(error);

  return path;
}

/**
 * Signed URLs for `messages.media_path` values, 60s, re-signed per fetch —
 * same policy as profile photos (architecture plan §7). The bucket is private
 * and the read policy re-evaluates `can_read_conversation` at sign time, so a
 * path that stops qualifying simply fails to sign. A failure is therefore
 * "render the placeholder", never an error state and never an explanation.
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
