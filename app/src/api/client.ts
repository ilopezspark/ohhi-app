import 'react-native-url-polyfill/auto';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

const extra = (Constants.expoConfig?.extra ?? {}) as {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

const supabaseUrl = extra.supabaseUrl;
const supabaseAnonKey = extra.supabaseAnonKey;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy app/.env.example ' +
      'to app/.env and fill in the values (see app/README.md).'
  );
}

// Session persistence over expo-secure-store, per docs/app-architecture-plan.md §3.
// SecureStore has a ~2KB per-key limit on some platforms; a Supabase session JSON can
// exceed that under some token payloads. This adapter does NOT chunk `setItem` across
// key.0/key.1/... yet — the architecture note asks to verify against the real token
// size before shipping and flag if chunking turns out to be needed. Flagged here,
// unverified: no session has been issued against this skeleton yet to measure.
const SecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

// expo-secure-store has no web implementation — every call throws
// `ExpoSecureStore.default.getValueWithKeyAsync is not a function` on web. Use
// localStorage there instead, guarded with try/catch since it can be absent or throw
// (SSR, Safari private browsing, disabled storage).
const WebStorageAdapter = {
  getItem: (key: string) => {
    try {
      return Promise.resolve(globalThis.localStorage?.getItem(key) ?? null);
    } catch {
      return Promise.resolve(null);
    }
  },
  setItem: (key: string, value: string) => {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // no-op: storage unavailable (SSR, private mode, quota exceeded, etc.)
    }
    return Promise.resolve();
  },
  removeItem: (key: string) => {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // no-op
    }
    return Promise.resolve();
  },
};

const authStorage = Platform.OS === 'web' ? WebStorageAdapter : SecureStoreAdapter;

// The anon/publishable key is public by design — it ships in the bundle. Every real
// authorization boundary is RLS/RPC-side, not key secrecy (architecture plan §8). Never
// put the service role key here.
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: authStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
