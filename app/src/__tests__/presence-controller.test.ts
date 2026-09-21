import type { AppStateStatus } from 'react-native';
import type { CampusGeometry, PresenceTier } from '../geo/tier';

// `src/api/*` all import the real Supabase client, which throws outside a real
// Expo config-eval context. Nothing here touches it — every api call is an
// injected dep — but the import has to resolve.
jest.mock('../api/client', () => ({ supabase: {}, SUPABASE_URL: 'https://example.test' }));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getCurrentPositionAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
}));

import {
  PresenceController,
  SAMPLE_INTERVAL_MS,
  TIER_HEARTBEAT_MS,
  type PresenceDeps,
} from '../presence/controller';
import type { LocationPermissionState } from '../presence/sample';
import { usePresenceStore } from '../presence/store';

const CAMPUS: CampusGeometry = {
  centerPoint: { lat: 42.3595, lng: -88.0102 },
  onCampusRadiusM: 800,
  nearbyRadiusM: 8000,
  countyBoundary: null,
  countyLabel: 'lake co.',
};

interface Harness {
  controller: PresenceController;
  deps: {
    sampleTier: jest.Mock<Promise<PresenceTier>, [CampusGeometry]>;
    getForegroundPermission: jest.Mock<Promise<LocationPermissionState>, []>;
    requestForegroundPermission: jest.Mock<Promise<LocationPermissionState>, []>;
    setMyTier: jest.Mock<Promise<void>, [PresenceTier]>;
    setHereNow: jest.Mock<Promise<void>, [boolean]>;
    pauseGrid: jest.Mock<Promise<void>, [boolean]>;
    touchActivity: jest.Mock<Promise<void>, []>;
  };
  /** Drives the injected AppState listener. */
  emitAppState: (state: AppStateStatus) => void;
  removeListener: jest.Mock;
}

function makeHarness(options: { permission?: LocationPermissionState; tier?: PresenceTier } = {}): Harness {
  const deps: Harness['deps'] = {
    sampleTier: jest.fn().mockResolvedValue(options.tier ?? 'on_campus'),
    getForegroundPermission: jest.fn().mockResolvedValue(options.permission ?? 'granted'),
    requestForegroundPermission: jest.fn().mockResolvedValue('granted'),
    setMyTier: jest.fn().mockResolvedValue(undefined),
    setHereNow: jest.fn().mockResolvedValue(undefined),
    pauseGrid: jest.fn().mockResolvedValue(undefined),
    touchActivity: jest.fn().mockResolvedValue(undefined),
  };

  let appStateHandler: ((state: AppStateStatus) => void) | null = null;
  const removeListener = jest.fn();

  const overrides: Partial<PresenceDeps> = {
    ...deps,
    store: usePresenceStore,
    currentAppState: () => 'active',
    addAppStateListener: (handler) => {
      appStateHandler = handler;
      return { remove: removeListener } as never;
    },
  };

  const controller = new PresenceController(overrides);

  return {
    controller,
    deps,
    emitAppState: (state) => appStateHandler?.(state),
    removeListener,
  };
}

/** Lets every pending promise settle without moving the fake clock. */
const flush = () => jest.advanceTimersByTimeAsync(0);

beforeEach(() => {
  jest.useFakeTimers();
  usePresenceStore.getState().reset();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('PresenceController — sampling and the set_my_tier write policy', () => {
  it('touches activity and samples immediately on start when foregrounded', async () => {
    const h = makeHarness();
    h.controller.setCampus(CAMPUS);
    h.controller.start();
    await flush();

    expect(h.deps.touchActivity).toHaveBeenCalledTimes(1);
    expect(h.deps.sampleTier).toHaveBeenCalledTimes(1);
    expect(h.deps.setMyTier).toHaveBeenCalledTimes(1);
    expect(h.deps.setMyTier).toHaveBeenCalledWith('on_campus');
    expect(usePresenceStore.getState().tier).toBe('on_campus');
  });

  it('samples every ~5 minutes but only writes when the tier changes', async () => {
    const h = makeHarness();
    h.controller.setCampus(CAMPUS);
    h.controller.start();
    await flush();
    expect(h.deps.setMyTier).toHaveBeenCalledTimes(1);

    // Two more samples, same tier, still inside the 20-minute heartbeat.
    await jest.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS);
    await jest.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS);
    expect(h.deps.sampleTier).toHaveBeenCalledTimes(3);
    expect(h.deps.setMyTier).toHaveBeenCalledTimes(1);

    // The tier changes -> immediate write, without waiting for the heartbeat.
    h.deps.sampleTier.mockResolvedValue('nearby');
    await jest.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS);
    expect(h.deps.setMyTier).toHaveBeenCalledTimes(2);
    expect(h.deps.setMyTier).toHaveBeenLastCalledWith('nearby');
  });

  it('heartbeats every 20 minutes even when the tier never changes', async () => {
    // Decision 11: tier_computed_at older than 24h makes the user invisible,
    // so a stationary user still has to write periodically.
    const h = makeHarness();
    h.controller.setCampus(CAMPUS);
    h.controller.start();
    await flush();
    expect(h.deps.setMyTier).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(TIER_HEARTBEAT_MS);
    expect(h.deps.setMyTier).toHaveBeenCalledTimes(2);
    expect(h.deps.setMyTier).toHaveBeenLastCalledWith('on_campus');

    await jest.advanceTimersByTimeAsync(TIER_HEARTBEAT_MS);
    expect(h.deps.setMyTier).toHaveBeenCalledTimes(3);
  });

  it('does not compute a tier until the campus geometry arrives', async () => {
    const h = makeHarness();
    h.controller.start();
    await flush();

    expect(h.deps.touchActivity).toHaveBeenCalledTimes(1);
    expect(h.deps.sampleTier).not.toHaveBeenCalled();
    expect(h.deps.setMyTier).not.toHaveBeenCalled();

    h.controller.setCampus(CAMPUS);
    await flush();
    expect(h.deps.sampleTier).toHaveBeenCalledTimes(1);
  });

  it('notifies tier-change subscribers only on an actual change', async () => {
    const h = makeHarness();
    const listener = jest.fn();
    h.controller.onTierChange(listener);
    h.controller.setCampus(CAMPUS);
    h.controller.start();
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(TIER_HEARTBEAT_MS);
    expect(h.deps.setMyTier).toHaveBeenCalledTimes(2); // heartbeat wrote
    expect(listener).toHaveBeenCalledTimes(1); // but nothing changed
  });
});

describe('PresenceController — permission denied (decision 43)', () => {
  it('writes set_my_tier("away") exactly once and stops sampling', async () => {
    const h = makeHarness({ permission: 'denied' });
    h.controller.setCampus(CAMPUS);
    h.controller.start();
    await flush();

    expect(h.deps.setMyTier).toHaveBeenCalledTimes(1);
    expect(h.deps.setMyTier).toHaveBeenCalledWith('away');
    expect(h.deps.sampleTier).not.toHaveBeenCalled();
    expect(usePresenceStore.getState().permission).toBe('denied');
    expect(usePresenceStore.getState().tier).toBe('away');

    // Several more ticks: no further writes, no location reads.
    await jest.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 6);
    expect(h.deps.setMyTier).toHaveBeenCalledTimes(1);
    expect(h.deps.sampleTier).not.toHaveBeenCalled();
  });

  it('treats "undetermined" as "not yet answered", not as a denial', async () => {
    const h = makeHarness({ permission: 'undetermined' });
    h.controller.setCampus(CAMPUS);
    h.controller.start();
    await flush();

    expect(h.deps.setMyTier).not.toHaveBeenCalled();
    expect(h.deps.sampleTier).not.toHaveBeenCalled();
    expect(usePresenceStore.getState().permission).toBe('undetermined');
  });

  it('resumes sampling once permission is granted', async () => {
    const h = makeHarness({ permission: 'denied' });
    h.controller.setCampus(CAMPUS);
    h.controller.start();
    await flush();
    expect(h.deps.setMyTier).toHaveBeenCalledWith('away');

    h.deps.getForegroundPermission.mockResolvedValue('granted');
    h.deps.requestForegroundPermission.mockResolvedValue('granted');
    await h.controller.requestPermission();
    await flush();

    expect(usePresenceStore.getState().permission).toBe('granted');
    expect(h.deps.sampleTier).toHaveBeenCalled();
    expect(h.deps.setMyTier).toHaveBeenLastCalledWith('on_campus');
  });

  it('never surfaces a sampling failure', async () => {
    const h = makeHarness();
    h.deps.sampleTier.mockRejectedValue(new Error('location services unavailable'));
    h.controller.setCampus(CAMPUS);
    h.controller.start();
    await expect(flush()).resolves.not.toThrow();
    expect(h.deps.setMyTier).not.toHaveBeenCalled();
  });
});

describe('PresenceController — lifecycle and timers', () => {
  it('clears its timer when the app backgrounds and restarts it on foreground', async () => {
    const h = makeHarness();
    h.controller.setCampus(CAMPUS);
    h.controller.start();
    await flush();
    const samplesAtStart = h.deps.sampleTier.mock.calls.length;

    h.emitAppState('background');
    await jest.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 4);
    expect(h.deps.sampleTier).toHaveBeenCalledTimes(samplesAtStart);
    expect(jest.getTimerCount()).toBe(0);

    h.emitAppState('active');
    await flush();
    // Foregrounding re-samples immediately and touches activity again.
    expect(h.deps.sampleTier).toHaveBeenCalledTimes(samplesAtStart + 1);
    expect(h.deps.touchActivity).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS);
    expect(h.deps.sampleTier).toHaveBeenCalledTimes(samplesAtStart + 2);
  });

  it('clears every timer and detaches the listener on stop', async () => {
    const h = makeHarness();
    h.controller.setCampus(CAMPUS);
    h.controller.start();
    await flush();
    expect(jest.getTimerCount()).toBeGreaterThan(0);

    h.controller.stop();
    expect(jest.getTimerCount()).toBe(0);
    expect(h.removeListener).toHaveBeenCalledTimes(1);
    expect(h.controller.isRunning()).toBe(false);

    const samples = h.deps.sampleTier.mock.calls.length;
    await jest.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 5);
    expect(h.deps.sampleTier).toHaveBeenCalledTimes(samples);
  });

  it('is idempotent across repeated start/stop', async () => {
    const h = makeHarness();
    h.controller.setCampus(CAMPUS);
    h.controller.start();
    h.controller.start();
    await flush();
    h.controller.stop();
    h.controller.stop();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('PresenceController — here-now and pause', () => {
  it('flips here-now optimistically and calls set_here_now', async () => {
    const h = makeHarness();
    await h.controller.setHereNow(true);
    expect(usePresenceStore.getState().hereNow).toBe(true);
    expect(h.deps.setHereNow).toHaveBeenCalledWith(true);
  });

  it('reverts here-now when the RPC refuses', async () => {
    const h = makeHarness();
    h.deps.setHereNow.mockRejectedValue(new Error('nope'));
    await expect(h.controller.setHereNow(true)).rejects.toThrow();
    expect(usePresenceStore.getState().hereNow).toBe(false);
  });

  it('maps paused=true onto pause_grid(false) — the argument is p_visible', async () => {
    const h = makeHarness();
    await h.controller.setPaused(true);
    expect(h.deps.pauseGrid).toHaveBeenCalledWith(false);
    expect(usePresenceStore.getState().paused).toBe(true);

    await h.controller.setPaused(false);
    expect(h.deps.pauseGrid).toHaveBeenLastCalledWith(true);
    expect(usePresenceStore.getState().paused).toBe(false);
  });

  it('reverts pause when the RPC refuses', async () => {
    const h = makeHarness();
    h.deps.pauseGrid.mockRejectedValue(new Error('nope'));
    await expect(h.controller.setPaused(true)).rejects.toThrow();
    expect(usePresenceStore.getState().paused).toBe(false);
  });
});

describe('the hard rule: no coordinate ever reaches an api call', () => {
  /** Anything that smells like a coordinate, at any depth. */
  function findCoordinateLike(value: unknown, path = 'arg'): string | null {
    if (typeof value === 'number') {
      // A bare number is not a coordinate by itself, but a *pair* is — see the
      // array branch below.
      return null;
    }
    if (Array.isArray(value)) {
      if (value.length === 2 && value.every((item) => typeof item === 'number')) {
        return `${path} is a number pair`;
      }
      for (let i = 0; i < value.length; i += 1) {
        const found = findCoordinateLike(value[i], `${path}[${i}]`);
        if (found) return found;
      }
      return null;
    }
    if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (/^(lat|lng|lon|latitude|longitude|coords|coordinate|geohash|accuracy|altitude)$/i.test(key)) {
          return `${path}.${key}`;
        }
        const found = findCoordinateLike(item, `${path}.${key}`);
        if (found) return found;
      }
    }
    return null;
  }

  it('passes nothing but a tier word / boolean to every api function', async () => {
    const h = makeHarness();
    h.controller.setCampus(CAMPUS);
    h.controller.start();
    await flush();

    h.deps.sampleTier.mockResolvedValue('county');
    await jest.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS);
    await h.controller.setHereNow(true);
    await h.controller.setPaused(true);

    const apiMocks = [
      ['setMyTier', h.deps.setMyTier],
      ['setHereNow', h.deps.setHereNow],
      ['pauseGrid', h.deps.pauseGrid],
      ['touchActivity', h.deps.touchActivity],
    ] as const;

    // Sanity: the writes we're inspecting actually happened.
    expect(h.deps.setMyTier.mock.calls.length).toBeGreaterThan(1);

    for (const [name, mock] of apiMocks) {
      for (const call of mock.mock.calls) {
        for (const arg of call as unknown[]) {
          expect(typeof arg === 'string' || typeof arg === 'boolean').toBe(true);
          const offender = findCoordinateLike(arg, name);
          expect(offender).toBeNull();
        }
      }
    }

    // And every tier argument is one of the four enum words, nothing else.
    for (const [tier] of h.deps.setMyTier.mock.calls) {
      expect(['on_campus', 'nearby', 'county', 'away']).toContain(tier);
    }
  });

  it('keeps nothing positional in the presence store', async () => {
    const h = makeHarness();
    h.controller.setCampus(CAMPUS);
    h.controller.start();
    await flush();

    const snapshot = usePresenceStore.getState();
    const dataKeys = Object.entries(snapshot)
      .filter(([, value]) => typeof value !== 'function')
      .map(([key]) => key);

    expect(dataKeys.sort()).toEqual(['hereNow', 'paused', 'permission', 'tier']);
  });
});
