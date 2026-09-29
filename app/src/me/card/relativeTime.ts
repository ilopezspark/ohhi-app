const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * `PrivateCard`'s "shared with" list copy (`02-private-card.png`: "sent 3
 * days ago", "sent last week") — a small relative-time formatter rather than
 * a new date-formatting dependency for one screen's one line of copy.
 * `now` is injectable for deterministic tests.
 */
export function relativeSentLabel(iso: string, now: Date = new Date()): string {
  const sentAt = new Date(iso).getTime();
  const diffMs = Math.max(0, now.getTime() - sentAt);

  if (diffMs < MINUTE) return 'sent just now';

  if (diffMs < HOUR) {
    const minutes = Math.floor(diffMs / MINUTE);
    return `sent ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }

  if (diffMs < DAY) {
    const hours = Math.floor(diffMs / HOUR);
    return `sent ${hours} hour${hours === 1 ? '' : 's'} ago`;
  }

  if (diffMs < WEEK) {
    const days = Math.floor(diffMs / DAY);
    return `sent ${days} day${days === 1 ? '' : 's'} ago`;
  }

  if (diffMs < WEEK * 2) return 'sent last week';

  const weeks = Math.floor(diffMs / WEEK);
  if (weeks < 5) return `sent ${weeks} weeks ago`;

  const months = Math.floor(diffMs / (DAY * 30));
  if (months <= 1) return 'sent last month';
  return `sent ${months} months ago`;
}
