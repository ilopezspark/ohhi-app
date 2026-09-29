import type { NotificationPrefsRow, NotificationPrefsUpdate } from '../../api/notificationPrefs';

/**
 * `docs/design/me-redesign/brief.md`'s Settings mapping: the artboard shows
 * two toggles, `notification_prefs` has four columns. `hi's and chats`
 * writes `hi_received`, `hi_back` and `new_message` together as one on/off
 * switch (never partially); `someone new around` is the lone
 * `someone_new_nearby` column.
 */
export const HI_AND_CHATS_KEYS = ['hi_received', 'hi_back', 'new_message'] as const;

/** The combined toggle reads "on" only when every one of its columns is true — a partially-on state (possible if a row was edited outside this screen) reads as off, so a tap always resolves it to a clean all-on state rather than getting stuck. */
export function hiAndChatsOn(prefs: Pick<NotificationPrefsRow, (typeof HI_AND_CHATS_KEYS)[number]>): boolean {
  return HI_AND_CHATS_KEYS.every((key) => prefs[key]);
}

export function hiAndChatsUpdate(next: boolean): NotificationPrefsUpdate {
  return { hi_received: next, hi_back: next, new_message: next };
}

export function someoneNewNearbyUpdate(next: boolean): NotificationPrefsUpdate {
  return { someone_new_nearby: next };
}
