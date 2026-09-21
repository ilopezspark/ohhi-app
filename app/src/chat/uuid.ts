/**
 * A v4 UUID for a message row the client mints *before* inserting it.
 *
 * Needed because `chat-media` objects live at
 * `{conversation_id}/{message_id}.jpg` and the upload has to happen before the
 * `messages` insert (the storage policy checks the conversation's state, not
 * the row's existence — plan §3). So the id cannot come from the database's
 * `gen_random_uuid()` default.
 *
 * `globalThis.crypto.randomUUID` exists on web and on Hermes with a polyfill;
 * bare React Native has neither it nor `getRandomValues`, and no crypto
 * package is installed (`expo-crypto` / `react-native-get-random-values` would
 * both be new dependencies). The `Math.random` fallback is therefore
 * deliberate and acceptable here: this value is a **primary key**, not a
 * secret or a capability. It is never used for auth, never guessed against —
 * the `chat-media` read policy gates on `can_read_conversation`, not on path
 * obscurity — and a collision only costs one failed insert.
 */
export function messageId(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof cryptoObj?.randomUUID === 'function') {
    try {
      return cryptoObj.randomUUID();
    } catch {
      // fall through
    }
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
