// Regression test for the web storage adapter in `client.ts`: expo-secure-store has no
// web implementation, so on web every call used to throw
// `ExpoSecureStore.default.getValueWithKeyAsync is not a function`. `client.ts` now
// picks a localStorage-backed adapter on web (Platform.OS === 'web') instead.
jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
  // expo-modules-core lazily touches this (via the global `fetch` shim) during test
  // teardown; without it it logs a caught, harmless "Cannot find native module" warning.
  TurboModuleRegistry: { get: () => null, getEnforcing: () => null },
}));

// Side-effecting polyfill only; it reaches into real react-native NativeModules, which
// the mock above doesn't provide. Not relevant to the storage-adapter behavior under test.
jest.mock('react-native-url-polyfill/auto', () => ({}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        supabaseUrl: 'https://example.supabase.co',
        supabaseAnonKey: 'anon-key',
      },
    },
  },
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: {} })),
}));

import { createClient } from '@supabase/supabase-js';
import './client';

type StorageAdapter = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

describe('supabase auth storage adapter on web (Platform.OS = "web")', () => {
  const mockCreateClient = createClient as unknown as jest.Mock;
  // client.ts is imported once above; grab the `auth.storage` adapter it built.
  const storage = mockCreateClient.mock.calls[0][2].auth.storage as StorageAdapter;

  const originalLocalStorage = (globalThis as any).localStorage;

  afterEach(() => {
    if (originalLocalStorage === undefined) {
      delete (globalThis as any).localStorage;
    } else {
      (globalThis as any).localStorage = originalLocalStorage;
    }
  });

  it('round-trips values through localStorage', async () => {
    const backing = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (key: string) => (backing.has(key) ? backing.get(key)! : null),
      setItem: (key: string, value: string) => {
        backing.set(key, value);
      },
      removeItem: (key: string) => {
        backing.delete(key);
      },
    };

    expect(await storage.getItem('session')).toBeNull();

    await storage.setItem('session', 'token-value');
    expect(await storage.getItem('session')).toBe('token-value');

    await storage.removeItem('session');
    expect(await storage.getItem('session')).toBeNull();
  });

  it('tolerates a missing localStorage (e.g. SSR)', async () => {
    delete (globalThis as any).localStorage;

    await expect(storage.getItem('session')).resolves.toBeNull();
    await expect(storage.setItem('session', 'token-value')).resolves.toBeUndefined();
    await expect(storage.removeItem('session')).resolves.toBeUndefined();
  });

  it('tolerates a localStorage that throws (e.g. Safari private mode)', async () => {
    (globalThis as any).localStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };

    await expect(storage.getItem('session')).resolves.toBeNull();
    await expect(storage.setItem('session', 'token-value')).resolves.toBeUndefined();
    await expect(storage.removeItem('session')).resolves.toBeUndefined();
  });
});
