import { useSyncExternalStore } from 'react';
import { supabase } from '../api/client';

/**
 * The signed-in user id, for the age gate's `me()` read (`routing/access.ts`).
 * One app-lifetime subscription to `getSession()` and `onAuthStateChange`,
 * started by the first reader, shared by every screen after it.
 *
 * `undefined` until the stored session has been read; `null` when signed out.
 */
let current: string | null | undefined = undefined;
let started = false;
const listeners = new Set<() => void>();

function set(next: string | null): void {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

function start(): void {
  if (started) return;
  started = true;
  try {
    supabase.auth
      .getSession()
      .then(({ data }) => set(data.session?.user.id ?? null))
      .catch(() => set(null));
    supabase.auth.onAuthStateChange((_event, session) => set(session?.user.id ?? null));
  } catch {
    // No auth client (a unit test's stub): signed out.
    set(null);
  }
}

/** Tests only: forget the subscription and the id. */
export function resetSessionUserForTests(): void {
  current = undefined;
  started = false;
  listeners.clear();
}

function subscribe(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): string | null | undefined {
  return current;
}

export function useSessionUserId(): string | null | undefined {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
