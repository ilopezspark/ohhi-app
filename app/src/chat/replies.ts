import type { MessageQuote } from '../api/replies';
import type { ReplyTarget } from '../api/messages';
import { displayName } from '../ui/displayName';
import type { ThreadMessage } from './MessageBubble';

/**
 * Replies in the thread (migration 0017, decision 93,
 * `docs/chat-replies-and-badges.md`): what the reply bar above the composer
 * says, and how a reply's quote renders. Pure, so every state is testable
 * without mounting the thread.
 *
 * Voice: lowercase, no reasons. An unavailable quote says `unavailable` and
 * nothing else, whether the photo was deleted, the share revoked or someone
 * blocked: the app cannot tell which and must not guess.
 */

export const QUOTE_UNAVAILABLE_COPY = 'unavailable';
export const QUOTE_LOADING_COPY = '…';

/** A reply being written: what the bar above the composer shows, and what the send attaches. */
export interface ReplyDraft {
  target: ReplyTarget;
  /** `you`-relative name: `yourself` for my own message, else their lowercase name. */
  name: string;
  /** The one line under the name: the text, or what the media is. */
  line: string;
  /** A kept photo's path, or a kept video's poster (`chat-media`), for the thumbnail. */
  thumbPath: string | null;
}

/** What a quoted message's media is called, when there is no text to show. */
export function mediaLabel(kind: 'photo' | 'video' | null | undefined, viewLimit?: number | null, limited?: boolean): string {
  const noun = kind === 'video' ? 'video' : 'photo';
  if (viewLimit === 1) return `view once ${noun}`;
  if (viewLimit === 2) return `view twice ${noun}`;
  if (limited) return `limited ${noun}`;
  return noun;
}

/** A message's text as one line, or its media's name. */
export function messageLine(message: Pick<ThreadMessage, 'body' | 'media_path' | 'media_kind' | 'view_limit'>): string {
  const body = message.body?.replace(/\s+/g, ' ').trim();
  if (body) return body;
  if (message.media_path || message.media_kind) return mediaLabel(message.media_kind, message.view_limit);
  return '';
}

/** Kept media's thumbnail path (a photo, or a video's poster). Never limited media. */
export function keptThumbPath(message: Pick<ThreadMessage, 'media_path' | 'media_kind' | 'view_limit' | 'media_poster_path'>): string | null {
  if (message.view_limit != null || !message.media_path) return null;
  return message.media_kind === 'video' ? message.media_poster_path : message.media_path;
}

/** Whose message it is, from where I sit. */
export function replyName(senderId: string | null | undefined, meId: string, otherFirstName: string | null | undefined): string {
  if (senderId && senderId === meId) return 'yourself';
  return displayName(otherFirstName) || 'someone';
}

/** The reply bar's draft for replying to `message`. */
export function replyDraftFor(message: ThreadMessage, meId: string, otherFirstName: string | null | undefined): ReplyDraft {
  return {
    target: { messageId: message.id },
    name: replyName(message.sender_id, meId, otherFirstName),
    line: messageLine(message),
    thumbPath: keptThumbPath(message),
  };
}

/** The `reply_kind` the server will write for this target: for an optimistic row only, never sent. */
export function replyKindFor(replyTo: ReplyTarget | null | undefined): string | null {
  if (!replyTo) return null;
  if ('messageId' in replyTo) return 'message';
  if ('albumPhotoId' in replyTo) return 'album_photo';
  if ('userPromptId' in replyTo) return 'user_prompt';
  return 'user_photo';
}

/** The four reference columns of a row about to be drawn (an optimistic reply): exactly one set, or none. */
export function replyReferenceColumns(
  replyTo: ReplyTarget | null | undefined
): Pick<ThreadMessage, 'reply_to_message_id' | 'reply_to_album_photo_id' | 'reply_to_user_prompt_id' | 'reply_to_user_photo_id'> {
  return {
    reply_to_message_id: replyTo && 'messageId' in replyTo ? replyTo.messageId : null,
    reply_to_album_photo_id: replyTo && 'albumPhotoId' in replyTo ? replyTo.albumPhotoId : null,
    reply_to_user_prompt_id: replyTo && 'userPromptId' in replyTo ? replyTo.userPromptId : null,
    reply_to_user_photo_id: replyTo && 'userPhotoId' in replyTo ? replyTo.userPhotoId : null,
  };
}

/** A row's reply reference back as a target, e.g. to retry a failed reply. */
export function replyTargetOf(
  row: Pick<ThreadMessage, 'reply_to_message_id' | 'reply_to_album_photo_id' | 'reply_to_user_prompt_id' | 'reply_to_user_photo_id'>
): ReplyTarget | null {
  if (row.reply_to_message_id) return { messageId: row.reply_to_message_id };
  if (row.reply_to_album_photo_id) return { albumPhotoId: row.reply_to_album_photo_id };
  if (row.reply_to_user_prompt_id) return { userPromptId: row.reply_to_user_prompt_id };
  if (row.reply_to_user_photo_id) return { userPhotoId: row.reply_to_user_photo_id };
  return null;
}

/** The reply bar's first line. */
export function replyingToLabel(name: string): string {
  return `replying to ${name}`;
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export type QuoteView =
  | { state: 'loading' }
  | { state: 'unavailable' }
  | {
      state: 'message';
      quotedMessageId: string;
      quotedCreatedAt: string | null;
      senderId: string | null;
      line: string;
      /** `chat-media` path for the thumbnail, only for kept media. */
      thumbPath: string | null;
      /** Limited media: a neutral placeholder square, never a thumbnail. */
      limited: boolean;
      mediaKind: 'photo' | 'video' | null;
    }
  | {
      state: 'album_photo';
      albumId: string | null;
      photoId: string;
      senderId: string | null;
      /** `album-photos` path for the thumbnail. */
      thumbPath: string | null;
    }
  | {
      /** Migration 0024: a prompt answer, replied to from its owner's profile. */
      state: 'prompt';
      /** The answer's owner. */
      senderId: string | null;
      question: string;
      answer: string;
    }
  | {
      /** Migration 0024: a profile photo, replied to from its owner's profile. */
      state: 'profile_photo';
      /** The photo's owner. */
      senderId: string | null;
      /** `profile-photos` path for the thumbnail. */
      thumbPath: string | null;
    };

/** The line under a profile photo quote's name. */
export const PROFILE_PHOTO_QUOTE_COPY = 'photo';

type ReplyRefs = Pick<
  ThreadMessage,
  'reply_kind' | 'reply_to_message_id' | 'reply_to_album_photo_id' | 'reply_to_user_prompt_id' | 'reply_to_user_photo_id'
>;

function referenceKind(reply: ReplyRefs): string | null {
  if (reply.reply_to_message_id) return 'message';
  if (reply.reply_to_album_photo_id) return 'album_photo';
  if (reply.reply_to_user_prompt_id) return 'user_prompt';
  if (reply.reply_to_user_photo_id) return 'user_photo';
  return null;
}

function hasReference(reply: ReplyRefs): boolean {
  return referenceKind(reply) !== null;
}

/**
 * How a reply's quote renders, from (in order) the server's live answer,
 * the quoted message when it is already on a loaded page, or nothing yet.
 *
 * - The server's row always wins: it is the live truth (a revoke, a delete
 *   or a block shows up there first). The quoted message's view limit, when
 *   it is loaded, only sharpens the placeholder's words (`view once photo`).
 * - A message quote can be drawn locally while the server's row is on its
 *   way (the same row `message_quotes` reads; decision 93 allows it). An
 *   album photo quote never is: it must come from `message_quotes`.
 * - Not a reply: null.
 */
export function resolveQuote(
  reply: ReplyRefs,
  quote: MessageQuote | undefined,
  loaded: ReadonlyMap<string, ThreadMessage>
): QuoteView | null {
  const kind = reply.reply_kind ?? referenceKind(reply);
  if (!kind) return null;

  if (quote) {
    if (!quote.available) return { state: 'unavailable' };
    // Migration 0024: a profile quote is only ever the server's live answer.
    if (quote.replyKind === 'user_prompt') {
      const question = quote.promptQuestion?.trim();
      const answer = quote.promptAnswer?.replace(/\s+/g, ' ').trim();
      if (!question || !answer) return { state: 'unavailable' };
      return { state: 'prompt', senderId: quote.quotedSenderId, question, answer };
    }
    if (quote.replyKind === 'user_photo') {
      if (!quote.photoPath) return { state: 'unavailable' };
      return { state: 'profile_photo', senderId: quote.quotedSenderId, thumbPath: quote.photoPath };
    }
    if (quote.replyKind === 'album_photo') {
      if (!quote.quotedAlbumPhotoId) return { state: 'unavailable' };
      return {
        state: 'album_photo',
        albumId: quote.albumId,
        photoId: quote.quotedAlbumPhotoId,
        senderId: quote.quotedSenderId,
        thumbPath: quote.mediaPath,
      };
    }
    if (!quote.quotedMessageId) return { state: 'unavailable' };
    const local = loaded.get(quote.quotedMessageId);
    const excerpt = quote.excerpt?.replace(/\s+/g, ' ').trim();
    return {
      state: 'message',
      quotedMessageId: quote.quotedMessageId,
      quotedCreatedAt: quote.quotedCreatedAt,
      senderId: quote.quotedSenderId,
      line: excerpt || (quote.mediaKind ? mediaLabel(quote.mediaKind, local?.view_limit, quote.isLimited) : ''),
      thumbPath: quote.isLimited ? null : quote.mediaKind === 'video' ? quote.mediaPosterPath : quote.mediaPath,
      limited: quote.isLimited,
      mediaKind: quote.mediaKind,
    };
  }

  if (kind === 'message' && reply.reply_to_message_id) {
    const local = loaded.get(reply.reply_to_message_id);
    if (local && !local.pending && !local.failed) {
      return {
        state: 'message',
        quotedMessageId: local.id,
        quotedCreatedAt: local.created_at,
        senderId: local.sender_id,
        line: messageLine(local),
        thumbPath: keptThumbPath(local),
        limited: local.view_limit != null,
        mediaKind: local.media_kind === 'video' ? 'video' : local.media_path ? 'photo' : null,
      };
    }
  }

  // `reply_kind` set with no reference left: the target was deleted.
  if (!hasReference(reply)) return { state: 'unavailable' };
  return { state: 'loading' };
}

/** Whose line the quote's name shows: `you` for mine, else their lowercase name. */
export function quoteName(senderId: string | null | undefined, meId: string, otherFirstName: string | null | undefined): string {
  if (senderId && senderId === meId) return 'you';
  return displayName(otherFirstName) || 'someone';
}

/** The quote's screen reader label. */
export function quoteAccessibilityLabel(view: QuoteView, name: string): string {
  switch (view.state) {
    case 'loading':
      return 'reply';
    case 'unavailable':
      return `reply, ${QUOTE_UNAVAILABLE_COPY}`;
    case 'album_photo':
      return `reply to ${name}, album photo`;
    case 'prompt':
      return `reply to ${name === 'you' ? 'your' : `${name}'s`} answer, ${view.question}, ${view.answer}`;
    case 'profile_photo':
      return `reply to ${name === 'you' ? 'your' : `${name}'s`} photo`;
    case 'message':
      return view.line ? `reply to ${name}, ${view.line}` : `reply to ${name}`;
  }
}

/** The reply ids on one page, in order, for one `message_quotes` call. */
export function replyIdsOf(messages: readonly Pick<ThreadMessage, 'id' | 'reply_kind' | 'pending' | 'failed'>[]): string[] {
  return messages.filter((message) => !!message.reply_kind && !message.pending && !message.failed).map((message) => message.id);
}
