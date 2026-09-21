// Shared across every OhHi edge function: environment access that fails loudly.
//
// Nothing here logs a value — an env var in this project is either a key, a
// service-role credential, or a DB connection string, and none of those belong
// in a log line (docs/edge-identity-plan.md §5). Errors name only the variable.

/** Reads a required env var. Throws naming the variable when it is missing. */
export function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value === "") {
    throw new MissingEnvError(name);
  }
  return value;
}

/** Reads an optional env var, falling back to `fallback` (default `undefined`). */
export function optionalEnv(name: string): string | undefined;
export function optionalEnv(name: string, fallback: string): string;
export function optionalEnv(
  name: string,
  fallback?: string,
): string | undefined {
  const value = Deno.env.get(name);
  return value === undefined || value === "" ? fallback : value;
}

/**
 * Returns the first of `names` that is set. Throws naming all of them when none
 * is — used where a project-specific override falls back to a platform-provided
 * variable (e.g. `IDENTITY_DB_URL` then `SUPABASE_DB_URL`).
 */
export function firstEnv(...names: string[]): string {
  for (const name of names) {
    const value = Deno.env.get(name);
    if (value !== undefined && value !== "") return value;
  }
  throw new MissingEnvError(names.join(" or "));
}

/** Thrown by every accessor above; `variable` is safe to log, the value is not. */
export class MissingEnvError extends Error {
  readonly variable: string;
  constructor(variable: string) {
    super(`Missing required environment variable: ${variable}`);
    this.name = "MissingEnvError";
    this.variable = variable;
  }
}
