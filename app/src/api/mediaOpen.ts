import { SUPABASE_URL, supabase } from './client';
import { mapSupabaseError } from './errors';

export interface MediaOpenResult {
  url: string;
  kind: 'photo' | 'video';
  /** Seconds the signed URL stays valid — 60, per decision CM-4. Reusable within that window, not single-fetch. */
  expiresIn: number;
  /** How many opens the *recipient* has left. Meaningless (and not returned meaningfully) for the sender's own bypass read (CM-3). */
  viewsRemaining: number;
}

/**
 * `POST /media-open {message_id}`, caller JWT (`docs/chat-media-plan.md` §4).
 * Plain `fetch`, not `supabase.functions.invoke` — same convention as
 * `api/identity.ts`/`api/verification.ts` (architecture plan §8).
 *
 * The function is not deployed yet (built alongside migration 0010 by a
 * concurrent agent per this build's brief); this client is written strictly
 * against the plan's contract so it degrades safely either way.
 *
 * Every refusal the function can raise — unauthenticated, not found, not the
 * recipient, `view_limit` null, exhausted, concurrent-open loser — comes back
 * as the identical 404 (§4 step 1/2/4, decision 24's generic-refusal
 * convention). This resolves to `null` for all of them: the viewer's caller is
 * the one place that decides what a `null` means (the recipient's "already
 * exhausted, flip to Opened" signal per §7, vs. everyone else's generic
 * "couldn't open" copy) — this function itself never guesses which.
 */
export async function openLimitedMedia(messageId: string): Promise<MediaOpenResult | null> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError) throw mapSupabaseError(sessionError);
  const accessToken = session?.access_token;
  if (!accessToken) return null; // Not signed in reads identically to any other refusal here.

  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/media-open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ message_id: messageId }),
    });
  } catch {
    // A dropped network reads exactly like a refusal — no distinguishing copy.
    return null;
  }

  if (response.status === 404) return null;
  if (!response.ok) throw mapSupabaseError(new Error(`media-open ${response.status}`));

  let body: Partial<{ url: string; kind: 'photo' | 'video'; expires_in: number; views_remaining: number }>;
  try {
    body = (await response.json()) as typeof body;
  } catch {
    return null;
  }

  if (!body.url || (body.kind !== 'photo' && body.kind !== 'video')) return null;

  return {
    url: body.url,
    kind: body.kind,
    expiresIn: body.expires_in ?? 60,
    viewsRemaining: body.views_remaining ?? 0,
  };
}
