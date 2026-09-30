import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import { normalizeLocalUri } from './readUpload';

/**
 * A local file's size in bytes, or `null` when it can't be read (web, a uri
 * expo-file-system may not open, a missing file). Used when the picker did
 * not report `fileSize` for a video: an album video's row has to carry its
 * size (migration 0025), and the 50 MB cap is checked against it before any
 * upload. `uploadLocalFile` checks the same file again right before sending.
 */
export function localFileSize(uri: string): number | null {
  if (Platform.OS === 'web') return null;
  try {
    const size = new File(normalizeLocalUri(uri)).size;
    return typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : null;
  } catch {
    return null;
  }
}
