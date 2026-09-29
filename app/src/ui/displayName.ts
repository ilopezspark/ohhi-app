/**
 * How a person's first name is shown anywhere it acts as a title or label
 * (profile hero, collapsed header, grid tile, chat header and list, story
 * header, share bubbles). Owner ruling, 29 September 2026: everything in
 * titles is lowercase, so "Tyler" shows as "tyler". The stored name is
 * never changed; this is display only.
 */
export function displayName(firstName: string | null | undefined): string {
  return (firstName ?? '').trim().toLocaleLowerCase();
}
