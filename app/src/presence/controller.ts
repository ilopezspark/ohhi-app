import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import { pauseGrid, setHereNow, setMyTier, touchActivity } from '../api/presence';
import type { CampusGeometry, PresenceTier } from '../geo/tier';
import {
  getForegroundPermission,
  requestForegroundPermission,
  sampleTier,
  type LocationPermissionState,
} from './sample';
import { usePresenceStore } from './store';

/**
 * ~5 minutes between location samples while foregrounded (decision 45).
 * Never continuous GPS, never a background task.
 */
export const SAMPLE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * `set_my_tier` is written when the computed tier **changes**, or when this
 * long has passed since the last write, whichever comes first (decision 45).
 * The floor exists so `user_presence.tier_computed_at` never drifts past
 * `is_grid_visible`'s 24-hour staleness cutoff (decision 11) for a user who
 * simply hasn't moved — 20 minutes leaves an enormous margin, which is the
 * point: the user should fall out of the grid because they left, not because
 * a heartbeat was missed.
 */
export const TIER_HEARTBEAT_MS = 20 * 60 * 1000;

/** Every dependency is injectable so the controller can be tested with fake timers. */
export interface PresenceDeps {
  sampleTier: (campus: CampusGeometry) => Promise<PresenceTier>;
  getForegroundPermission: () => Promise<LocationPermissionState>;
  requestForegroundPermission: () => Promise<LocationPermissionState>;
  setMyTier: (tier: PresenceTier) => Promise<void>;
  setHereNow: (on: boolean) => Promise<void>;
  pauseGrid: (visible: boolean) => Promise<void>;
  touchActivity: () => Promise<void>;
  store: typeof usePresenceStore;
  now: () => number;
  addAppStateListener: (handler: (state: AppStateStatus) => void) => NativeEventSubscription;
  currentAppState: () => AppStateStatus;
}

const defaultDeps = (): PresenceDeps => ({
  sampleTier,
  getForegroundPermission,
  requestForegroundPermission,
  setMyTier,
  setHereNow,
  pauseGrid,
  touchActivity,
  store: usePresenceStore,
  now: () => Date.now(),
  addAppStateListener: (handler) => AppState.addEventListener('change', handler),
  currentAppState: () => AppState.currentState,
});

const isForeground = (state: AppStateStatus): boolean => state === 'active';

/**
 * The presence and tiering module's controller (architecture plan §5).
 *
 * Lifecycle: `start()` attaches an `AppState` listener and, if the app is
 * already foregrounded, immediately touches activity and takes a sample.
 * Backgrounding clears every timer; foregrounding re-samples immediately and
 * restarts them. `stop()` clears everything and detaches the listener —
 * `usePresence()` calls it on unmount, so a timer can never outlive the screen
 * that started it.
 *
 * Nothing here ever holds or forwards a coordinate: `deps.sampleTier` returns
 * a tier word and that is the only positional information that exists above
 * `src/presence/sample.ts`.
 */
export class PresenceController {
  private readonly deps: PresenceDeps;

  private campus: CampusGeometry | null = null;
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private appStateSubscription: NativeEventSubscription | null = null;
  private lastAppState: AppStateStatus = 'active';

  private lastSentTier: PresenceTier | null = null;
  private lastSentAt: number | null = null;
  /** Set once the single `set_my_tier('away')` for a denial has been written. */
  private awayWrittenForDenial = false;

  private readonly tierListeners = new Set<(tier: PresenceTier) => void>();

  constructor(deps: Partial<PresenceDeps> = {}) {
    this.deps = { ...defaultDeps(), ...deps };
    this.lastAppState = this.deps.currentAppState();
  }

  /**
   * The campus geometry to tier against, fetched once per session via
   * `fetchCampusGeometry()` and cached by React Query. Until it is set, the
   * controller does everything except compute a tier — permission, here-now
   * and pause all work without it.
   */
  setCampus(campus: CampusGeometry | null): void {
    const hadNone = this.campus === null;
    this.campus = campus;
    if (campus && hadNone && this.running && isForeground(this.lastAppState)) {
      void this.refresh();
    }
  }

  /** Subscribe to computed-tier changes (the grid refetches on these). */
  onTierChange(listener: (tier: PresenceTier) => void): () => void {
    this.tierListeners.add(listener);
    return () => {
      this.tierListeners.delete(listener);
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    this.appStateSubscription = this.deps.addAppStateListener((next) => {
      const cameToForeground = !isForeground(this.lastAppState) && isForeground(next);
      const wentToBackground = isForeground(this.lastAppState) && !isForeground(next);
      this.lastAppState = next;

      // No realtime, no sampling and no timers while backgrounded — there is
      // no reliable background execution without an entitlement decision 5
      // rules out (architecture plan §5/§6).
      if (wentToBackground) this.clearTimer();
      if (cameToForeground) void this.onForeground();
    });

    this.lastAppState = this.deps.currentAppState();
    if (isForeground(this.lastAppState)) void this.onForeground();
  }

  stop(): void {
    this.running = false;
    this.clearTimer();
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
  }

  /** True while `start()` is in effect — used by tests and by `usePresence`. */
  isRunning(): boolean {
    return this.running;
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private startTimer(): void {
    this.clearTimer();
    this.timer = setInterval(() => {
      void this.tick();
    }, SAMPLE_INTERVAL_MS);
  }

  private async onForeground(): Promise<void> {
    // `touch_activity()` on foreground — the only write path for
    // `profiles.last_active_at`, which the grid sorts by (defect K).
    await this.safely(() => this.deps.touchActivity());
    await this.refresh();
    if (this.running && isForeground(this.lastAppState)) this.startTimer();
  }

  private async tick(): Promise<void> {
    await this.safely(() => this.deps.touchActivity());
    await this.refresh();
  }

  /**
   * One permission check + one sample + at most one `set_my_tier` write.
   * Public so the grid's pull-to-refresh can force a fresh tier.
   */
  async refresh(): Promise<void> {
    const permission = await this.safely(() => this.deps.getForegroundPermission());
    if (permission === undefined) return;

    this.deps.store.getState().setPermission(permission);

    if (permission !== 'granted') {
      await this.handleDenied(permission);
      return;
    }

    this.awayWrittenForDenial = false;
    if (!this.campus) return;

    const campus = this.campus;
    const tier = await this.safely(() => this.deps.sampleTier(campus));
    if (tier === undefined) return;

    this.applyTier(tier);
  }

  /**
   * Decision 43 / onboarding-grid plan §4: with no permission we cannot
   * compute a tier at all, so write `away` **once** and stop trying. The grid
   * stays fully browsable — `grid_for_me()` has no dependency on the caller's
   * own tier — only the user's own visibility to others is affected.
   *
   * `undetermined` (never asked, or asked and dismissable) is not a denial:
   * hold the last known tier and wait for the user to answer the prompt,
   * rather than marking them away on a first launch they haven't responded to.
   */
  private async handleDenied(permission: LocationPermissionState): Promise<void> {
    if (permission !== 'denied') return;
    if (this.awayWrittenForDenial) return;

    this.awayWrittenForDenial = true;
    this.applyTier('away', { force: true });
  }

  private applyTier(tier: PresenceTier, options: { force?: boolean } = {}): void {
    const store = this.deps.store.getState();
    const changed = tier !== this.lastSentTier;
    if (changed) store.setTier(tier);

    const now = this.deps.now();
    const heartbeatDue =
      this.lastSentAt === null || now - this.lastSentAt >= TIER_HEARTBEAT_MS;

    if (!options.force && !changed && !heartbeatDue) return;

    this.lastSentTier = tier;
    this.lastSentAt = now;
    void this.safely(() => this.deps.setMyTier(tier));

    if (changed) {
      for (const listener of this.tierListeners) listener(tier);
    }
  }

  /**
   * Prompts for foreground location. Called from the explicit "turn on
   * location" affordance, after the app's own explainer copy — never as a
   * surprise on first render.
   */
  async requestPermission(): Promise<LocationPermissionState> {
    const permission =
      (await this.safely(() => this.deps.requestForegroundPermission())) ?? 'denied';
    this.deps.store.getState().setPermission(permission);

    if (permission === 'granted') {
      this.awayWrittenForDenial = false;
      await this.refresh();
      if (this.running && isForeground(this.lastAppState)) this.startTimer();
    } else {
      await this.handleDenied(permission);
    }

    return permission;
  }

  /**
   * The explicit here-now toggle. Optimistic in the store, reverted if the RPC
   * refuses. This is the only call that fires the
   * `presence:campus:<campus_id>` broadcast — via the `broadcast_here_now`
   * trigger on `here_now_until`, server-side, with no client broadcast.
   */
  async setHereNow(on: boolean): Promise<void> {
    const store = this.deps.store.getState();
    const previous = store.hereNow;
    store.setHereNow(on);
    try {
      await this.deps.setHereNow(on);
    } catch (error) {
      this.deps.store.getState().setHereNow(previous);
      throw error;
    }
  }

  /** `paused = true` maps to `pause_grid(false)` — the argument is `p_visible`. */
  async setPaused(paused: boolean): Promise<void> {
    const store = this.deps.store.getState();
    const previous = store.paused;
    store.setPaused(paused);
    try {
      await this.deps.pauseGrid(!paused);
    } catch (error) {
      this.deps.store.getState().setPaused(previous);
      throw error;
    }
  }

  /**
   * Swallows failures from background work. Presence writes are fire-and-
   * forget housekeeping — a failed heartbeat is retried on the next tick, and
   * surfacing it would both be noise and risk leaking a refusal reason
   * (decision 24). Nothing is logged: an `expo-location` error object can
   * carry provider detail, and this module logs nothing, ever.
   */
  private async safely<T>(run: () => Promise<T>): Promise<T | undefined> {
    try {
      return await run();
    } catch {
      return undefined;
    }
  }
}

let singleton: PresenceController | null = null;

/** The app-wide controller. One per process; created lazily. */
export function getPresenceController(): PresenceController {
  if (!singleton) singleton = new PresenceController();
  return singleton;
}

/** Test/sign-out seam: drops the singleton so the next call builds a fresh one. */
export function resetPresenceController(): void {
  singleton?.stop();
  singleton = null;
}
