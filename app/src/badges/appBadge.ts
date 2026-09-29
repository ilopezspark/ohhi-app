/**
 * The app icon badge: the single seam every caller goes through.
 *
 * Today this does nothing. Setting an icon badge needs `expo-notifications`
 * (`setBadgeCountAsync`), which this app does not install yet: in Expo Go it
 * would badge Expo Go's own icon rather than this app's, and on Android the
 * package logs that remote notifications were removed from Expo Go. It
 * belongs with the push work (decision 41), in a development build, where
 * the push payload also carries the count while the app is closed.
 *
 * When that lands, only this function changes: guard by platform, never ask
 * for notification permission just to set a badge (skip quietly when it has
 * not been granted), and treat every failure as nothing to show.
 */
export async function setAppBadge(_count: number): Promise<void> {
  // Intentionally empty until `expo-notifications` is installed (see above).
}
