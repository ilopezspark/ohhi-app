import { supabase } from './client';
import { mapSupabaseError } from './errors';

/**
 * A reply's quote, resolved live by `public.message_quotes` (migration 0017,
 * decision 93, `docs/chat-replies-and-badges.md` §1). Never a snapshot: a
 * delete, a revoke or a block makes it unavailable, a replaced album photo
 * shows the new one, and a re-share brings it back.
 *
 * When `available` is false every field after it is null, and the app says
 * only `unavailable`, never why.
 */
export interface MessageQuote {
  /** The reply (the id that was asked about). */
  messageId: string;
  /**
   * What the reply quotes. `user_prompt` and `user_photo` (migration 0024,
   * decision 100) are the other person's prompt answer or profile photo,
   * replied to from their profile.
   */
  replyKind: QuoteReplyKind;
  available: boolean;
  /** A message quote: the original, to scroll to. */
  quotedMessageId: string | null;
  /** An album photo quote: the photo, to open the story at. */
  quotedAlbumPhotoId: string | null;
  /** Who wrote the quoted message, or who owns the quoted photo or prompt answer. */
  quotedSenderId: string | null;
  quotedCreatedAt: string | null;
  /** The first 120 characters of the quoted message's text, or null. */
  excerpt: string | null;
  mediaKind: 'photo' | 'video' | null;
  /** View once or view twice media: never has a path, for anyone. */
  isLimited: boolean;
  /** Keep-in-chat media: a `chat-media` path. Album photo: an `album-photos` path. */
  mediaPath: string | null;
  /** A keep-in-chat video's poster (`chat-media`). */
  mediaPosterPath: string | null;
  /** An album photo quote's album, to open the story. */
  albumId: string | null;
  /** A prompt quote: the prompt's question now. */
  promptQuestion: string | null;
  /** A prompt quote: the answer text now (an edit shows through). */
  promptAnswer: string | null;
  /** A profile photo quote: its `profile-photos` path now. Sign with `photos.signedPhotoUrls`. */
  photoPath: string | null;
}

export type QuoteReplyKind = 'message' | 'album_photo' | 'user_prompt' | 'user_photo';

const REPLY_KINDS: readonly QuoteReplyKind[] = ['message', 'album_photo', 'user_prompt', 'user_photo'];

/** An unknown kind reads as a message quote, which with no quoted message renders `unavailable`. */
function replyKindOf(value: string | null | undefined): QuoteReplyKind {
  return REPLY_KINDS.includes(value as QuoteReplyKind) ? (value as QuoteReplyKind) : 'message';
}

/** The RPC looks at no more than this many ids per call. */
export const MESSAGE_QUOTES_MAX_IDS = 200;

interface QuoteRow {
  message_id: string;
  reply_kind: string;
  available: boolean;
  quoted_message_id: string | null;
  quoted_album_photo_id: string | null;
  quoted_sender_id: string | null;
  quoted_created_at: string | null;
  excerpt: string | null;
  media_kind: string | null;
  is_limited: boolean | null;
  media_path: string | null;
  media_poster_path: string | null;
  album_id: string | null;
  quote_kind?: string | null;
  prompt_question?: string | null;
  prompt_answer?: string | null;
  photo_path?: string | null;
}

function toQuote(row: QuoteRow): MessageQuote {
  const available = row.available === true;
  return {
    messageId: row.message_id,
    replyKind: replyKindOf(row.reply_kind),
    available,
    quotedMessageId: available ? row.quoted_message_id : null,
    quotedAlbumPhotoId: available ? row.quoted_album_photo_id : null,
    quotedSenderId: available ? row.quoted_sender_id : null,
    quotedCreatedAt: available ? row.quoted_created_at : null,
    excerpt: available ? row.excerpt : null,
    mediaKind: available && (row.media_kind === 'photo' || row.media_kind === 'video') ? row.media_kind : null,
    isLimited: available && row.is_limited === true,
    // Belt and braces: the server never returns a path for limited media, and
    // this never passes one on even if it did.
    mediaPath: available && row.is_limited !== true ? row.media_path : null,
    mediaPosterPath: available && row.is_limited !== true ? row.media_poster_path : null,
    albumId: available ? row.album_id : null,
    promptQuestion: available ? (row.prompt_question ?? null) : null,
    promptAnswer: available ? (row.prompt_answer ?? null) : null,
    photoPath: available ? (row.photo_path ?? null) : null,
  };
}

/**
 * Quotes for a set of replies, keyed by reply id.
 *
 * Ids that are not replies, unknown ids and replies in a thread the caller
 * can no longer read are simply missing from the result: that is the RPC's
 * contract, not an error. Duplicates are dropped, and more than 200 ids are
 * sent in batches of 200. No ids, no request.
 *
 * Resolving a quote never counts a view and never opens limited media.
 */
export async function messageQuotes(ids: string[]): Promise<Record<string, MessageQuote>> {
  const unique = Array.from(new Set(ids.filter((id) => !!id)));
  const quotes: Record<string, MessageQuote> = {};
  for (let start = 0; start < unique.length; start += MESSAGE_QUOTES_MAX_IDS) {
    const batch = unique.slice(start, start + MESSAGE_QUOTES_MAX_IDS);
    const { data, error } = await supabase.rpc('message_quotes', { p_message_ids: batch });
    if (error) throw mapSupabaseError(error);
    for (const row of (data ?? []) as QuoteRow[]) {
      quotes[row.message_id] = toQuote(row);
    }
  }
  return quotes;
}
