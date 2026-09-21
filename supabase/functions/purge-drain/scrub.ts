// auth.users scrub-and-ban for purged accounts
// (docs/edge-purge-plan.md §3, decisions 30/31). Never deletes a row, never
// bans/edits a user whose `deleted_at` is null -- the cohort query
// (`db.ts`'s `purgedNotYetScrubbedCohort`) enforces both by construction.

import type { DbClient, ScrubCandidate } from "./db.ts";

export interface AdminUser {
  id: string;
  email?: string | null;
  phone?: string | null;
  banned_until?: string | null;
}

export interface AdminGetUserResult {
  data: { user: AdminUser | null } | null;
  error: { message: string } | null;
}

export interface AdminUpdateResult {
  data: unknown;
  error: { message: string } | null;
}

/**
 * Structurally matches supabase-js's `SupabaseClient['auth']['admin']`,
 * narrowed to the two calls this file makes. `updateUserById` is the only
 * write path used -- `deleteUser` is never called, per decision 31 and the
 * `profiles.id -> auth.users(id) on delete restrict` FK.
 */
export interface AdminClient {
  getUserById(uid: string): Promise<AdminGetUserResult>;
  updateUserById(
    uid: string,
    attrs: {
      email: string;
      phone: string;
      user_metadata: Record<string, never>;
      app_metadata: Record<string, never>;
      ban_duration: string;
    },
  ): Promise<AdminUpdateResult>;
}

export interface ScrubResult {
  candidates: number;
  scrubbed: number;
  skipped: number;
  errors: Array<{ userId: string; message: string }>;
}

/** Deterministic per uid, so re-running the scrub is a no-op (docs/edge-purge-plan.md §3/§6). */
export function scrubbedEmailFor(uid: string): string {
  return `deleted-${uid}@purged.invalid`;
}

/**
 * A row already carrying the deterministic scrubbed email is treated as
 * already-scrubbed and skipped, rather than re-issuing an identical Admin
 * API call (and a fresh ban timestamp) every run.
 */
function alreadyScrubbed(user: AdminUser, uid: string): boolean {
  return user.email === scrubbedEmailFor(uid);
}

/**
 * ~100 years. supabase-js's Admin API wants a Postgres interval string for
 * `ban_duration` and has no literal "forever"; this is the same permanent-
 * block posture as decisions 8/27, reused here per decision 31.
 */
const PERMANENT_BAN_DURATION = "876000h";

/**
 * Deviation to note: decision 31 / docs/edge-purge-plan.md §3 also call for
 * clearing the user's *identities*. supabase-js's Admin API has no
 * documented `updateUserById` field for that (identities are unlinked via
 * `auth.unlinkIdentity`, a user-session call, not an admin one), so this
 * function only randomizes email/phone, clears both metadata objects, and
 * bans the id -- the well-documented three-quarters of the scrub. Clearing
 * identities for an OAuth-linked purged account is left as a follow-up; v1
 * signup is school-email based, so the identities array is expected to be
 * empty for the accounts this cohort actually contains.
 */
export async function scrubPurgedUsers(
  db: DbClient,
  admin: AdminClient,
): Promise<ScrubResult> {
  const cohort: ScrubCandidate[] = await db.purgedNotYetScrubbedCohort();
  let scrubbed = 0;
  let skipped = 0;
  const errors: Array<{ userId: string; message: string }> = [];

  for (const candidate of cohort) {
    const uid = candidate.user_id;

    // Defense-in-depth: the cohort query already filters on this, but this
    // function must never scrub/ban a user whose deleted_at is null, full
    // stop -- re-assert it here rather than trusting the query alone.
    if (candidate.deleted_at === null) {
      skipped++;
      continue;
    }

    const { data, error: getError } = await admin.getUserById(uid);
    if (getError) {
      errors.push({ userId: uid, message: getError.message });
      continue;
    }

    const user = data?.user ?? null;
    if (!user) {
      // Already gone from auth.users, or never existed under this id --
      // nothing to scrub. Not a failure.
      skipped++;
      continue;
    }

    if (alreadyScrubbed(user, uid)) {
      skipped++;
      continue;
    }

    const { error: updateError } = await admin.updateUserById(uid, {
      email: scrubbedEmailFor(uid),
      phone: "",
      user_metadata: {},
      app_metadata: {},
      ban_duration: PERMANENT_BAN_DURATION,
    });
    if (updateError) {
      errors.push({ userId: uid, message: updateError.message });
      continue;
    }

    scrubbed++;
  }

  return { candidates: cohort.length, scrubbed, skipped, errors };
}
