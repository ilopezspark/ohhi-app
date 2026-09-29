/**
 * Copies a message's text (the press-and-hold menu's `copy`). `expo-clipboard`
 * is part of Expo Go and works on web. It is loaded on first use, so a
 * build or test without its native module only loses `copy`, never the
 * thread. Resolves false when nothing was copied; never throws.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Clipboard = require('expo-clipboard') as typeof import('expo-clipboard');
    return await Clipboard.setStringAsync(text);
  } catch {
    return false;
  }
}
