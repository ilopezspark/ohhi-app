// Shared across every OhHi edge function: the two Supabase clients, never one
// (docs/edge-identity-plan.md §2).
//
//  - `callerUid()` builds an anon-key client from the caller's own bearer token
//    and asks the auth server who they are. It can read nothing sensitive:
//    `payload_ciphertext` is not column-granted to `authenticated` and every
//    write to those tables is revoked, so there is no temptation to reuse it.
//  - `serviceClient()` is the service-role client, for Storage/auth-admin work.
//    It does NOT reach the `private` schema: `private` is not in
//    `config.toml`'s exposed `schemas`, so PostgREST never surfaces those RPCs
//    under any role. A function needing them opens its own Postgres connection.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requiredEnv } from "./env.ts";

const CLIENT_OPTIONS = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};

/** Service-role client. Never built from a caller-supplied header. */
export function serviceClient(): SupabaseClient {
  return createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    CLIENT_OPTIONS,
  );
}

/** Extracts the raw bearer token, or null when the header is absent/malformed. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization") ??
    req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() || null : null;
}

/**
 * Verifies the caller's JWT and returns their `auth.uid()`, or null when the
 * token is missing, malformed, expired, or rejected. Never throws for a bad
 * token — a null return is the 401 signal.
 */
export async function callerUid(req: Request): Promise<string | null> {
  const token = bearerToken(req);
  if (!token) return null;
  const client = createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_ANON_KEY"),
    {
      ...CLIENT_OPTIONS,
      global: { headers: { Authorization: `Bearer ${token}` } },
    },
  );
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user?.id) return null;
  return data.user.id;
}
