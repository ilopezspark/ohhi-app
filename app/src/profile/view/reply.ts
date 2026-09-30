import type { ReplyTarget } from '../../api/messages';
import type { ProfileReplyTarget } from '../../api/profileCard';
import type { CardCta } from '../../card/cta';
import { composerState, MAX_OPENER_LENGTH, type ConversationRules } from '../../chat/rules';
import type { ProfilePrompt } from './model';

/**
 * Replying to part of someone's profile (migration 0024, decision 100: "for
 * now just replying to prompts and photos"). Pure, so the gating is testable
 * without mounting the screen.
 *
 * Only what `profile_reply_targets` returned gets a reply action: a prompt
 * answer is matched to the card by `prompt_id`, a photo by its storage path.
 * Anything the list leaves out (a gated prompt before the gate, a photo not
 * `ok`, a card the viewer cannot see) has no action at all, never a disabled
 * one.
 */

/** What the reply sheet quotes, and the id the send carries. */
export type ProfileReplySubject =
  | { kind: 'prompt'; targetId: string; promptId: string; question: string; answer: string }
  | { kind: 'photo'; targetId: string; path: string; position: number };

/** prompt id -> `user_prompts.id`, photo path -> `user_photos.id`. */
export interface ProfileReplyIndex {
  prompts: Record<string, string>;
  photos: Record<string, string>;
}

export const EMPTY_REPLY_INDEX: ProfileReplyIndex = { prompts: {}, photos: {} };

export function indexReplyTargets(targets: readonly ProfileReplyTarget[] | null | undefined): ProfileReplyIndex {
  const index: ProfileReplyIndex = { prompts: {}, photos: {} };
  for (const target of targets ?? []) {
    if (target.kind === 'user_prompt') index.prompts[target.promptId] = target.targetId;
    else index.photos[target.photoPath] = target.targetId;
  }
  return index;
}

/** What the profile view needs to draw reply actions. Omitted (or in a preview): none. */
export interface ProfileReplyOptions {
  index: ProfileReplyIndex;
  onReply: (subject: ProfileReplySubject) => void;
}

export function promptReplySubject(
  prompt: ProfilePrompt,
  index: ProfileReplyIndex
): Extract<ProfileReplySubject, { kind: 'prompt' }> | null {
  const targetId = index.prompts[prompt.promptId];
  if (!targetId) return null;
  return { kind: 'prompt', targetId, promptId: prompt.promptId, question: prompt.question, answer: prompt.answer };
}

export function photoReplySubject(
  path: string | undefined,
  position: number,
  index: ProfileReplyIndex
): Extract<ProfileReplySubject, { kind: 'photo' }> | null {
  if (!path) return null;
  const targetId = index.photos[path];
  if (!targetId) return null;
  return { kind: 'photo', targetId, path, position };
}

/** A stable key for one subject, e.g. to start the sheet's draft fresh for each. */
export function replySubjectKey(subject: ProfileReplySubject): string {
  return `${subject.kind}:${subject.targetId}`;
}

export const REPLY_ACTION_LABEL = 'reply';
export const PROMPT_REPLY_A11Y = 'reply to this answer';
export const PHOTO_REPLY_A11Y = 'reply to this photo';

/** The reply column a profile reply sends (migration 0024): the answer's or the photo's id. */
export function profileReplyTarget(subject: ProfileReplySubject): ReplyTarget {
  return subject.kind === 'prompt' ? { userPromptId: subject.targetId } : { userPhotoId: subject.targetId };
}

/**
 * Where a reply from the profile can go, from the say-hi/message state: with
 * no conversation, as the opener (the same two states that offer Message);
 * with one, into it, if its composer would take a message from me now
 * (`chat/rules.composerState`, so a locked thread gets no reply actions
 * rather than a refusal). Anything else (a hi sent and not answered yet, the
 * transitional state, a thread still loading): no reply actions.
 */
export type ProfileReplyMode = { mode: 'opener' | 'thread'; maxLength: number } | null;

export function profileReplyMode(
  ctaKind: CardCta['kind'],
  thread: ConversationRules | null,
  meId: string | null,
  lastMessage: { sender_id: string } | null
): ProfileReplyMode {
  if (ctaKind === 'hi_and_message' || ctaKind === 'message_opener') {
    return { mode: 'opener', maxLength: MAX_OPENER_LENGTH };
  }
  if (ctaKind !== 'message' || !thread || !meId) return null;
  const composer = composerState(thread, meId, lastMessage);
  if (!composer.canSend) return null;
  // After a hi back, the opener's first message is still the one message.
  return { mode: composer.maxLength === MAX_OPENER_LENGTH ? 'opener' : 'thread', maxLength: composer.maxLength };
}
