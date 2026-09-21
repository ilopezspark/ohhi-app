import { useCallback, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchCampusGeometry } from '../api/campuses';
import type { CampusGeometry, PresenceTier } from '../geo/tier';
import { getPresenceController } from './controller';
import type { LocationPermissionState } from './sample';
import { usePresenceStore } from './store';

export interface UsePresenceResult {
  /** Last tier computed on this device; `null` before the first sample. */
  tier: PresenceTier | null;
  permission: LocationPermissionState;
  hereNow: boolean;
  paused: boolean;
  /** The county tier's display word for this campus, e.g. "lake co.". */
  countyLabel: string | null;
  /** False while the campus geometry is still loading. */
  ready: boolean;
  requestPermission: () => Promise<LocationPermissionState>;
  setHereNow: (on: boolean) => Promise<void>;
  setPaused: (paused: boolean) => Promise<void>;
  /** Force an immediate sample (pull-to-refresh). */
  refresh: () => Promise<void>;
  /** Subscribe to computed-tier changes. Returns an unsubscribe function. */
  onTierChange: (listener: (tier: PresenceTier) => void) => () => void;
}

/**
 * The presence module's React surface (architecture plan §5's API contract,
 * expressed as a hook instead of three loose functions so the tier/permission
 * values re-render their consumers).
 *
 * Note what this returns: four scalars and four callbacks. There is no
 * accessor here — or anywhere else under `src/presence/` — that hands out a
 * coordinate, a distance, or anything else positional. `tierFor` in
 * `src/geo/tier.ts` is the only consumer of a location sample in the app.
 *
 * `campusId` comes from `me()`. Pass `null` while it is still loading; the
 * controller runs anyway (permission, here-now and pause all work without
 * geometry) and starts tiering as soon as the geometry arrives.
 */
export function usePresence(campusId: string | null): UsePresenceResult {
  const controller = useMemo(() => getPresenceController(), []);

  const tier = usePresenceStore((state) => state.tier);
  const permission = usePresenceStore((state) => state.permission);
  const hereNow = usePresenceStore((state) => state.hereNow);
  const paused = usePresenceStore((state) => state.paused);

  // Fetched once per campus and held for the session: the centroid, radii and
  // county polygon do not change under us (architecture plan §5's "long
  // staleTime" cache). `retry: false` because a decode failure is a bug, not a
  // transient — retrying it four times just delays the away fallback.
  const { data: campus, isPending: campusPending } = useQuery<CampusGeometry>({
    queryKey: ['campus_geometry', campusId],
    queryFn: () => fetchCampusGeometry(campusId as string),
    enabled: !!campusId,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    controller.setCampus(campus ?? null);
  }, [controller, campus]);

  useEffect(() => {
    controller.start();
    // Timers and the AppState listener are torn down here — nothing survives
    // unmount, and `stop()` is idempotent.
    return () => controller.stop();
  }, [controller]);

  const requestPermission = useCallback(() => controller.requestPermission(), [controller]);
  const setHereNow = useCallback((on: boolean) => controller.setHereNow(on), [controller]);
  const setPaused = useCallback((next: boolean) => controller.setPaused(next), [controller]);
  const refresh = useCallback(() => controller.refresh(), [controller]);
  const onTierChange = useCallback(
    (listener: (next: PresenceTier) => void) => controller.onTierChange(listener),
    [controller]
  );

  return {
    tier,
    permission,
    hereNow,
    paused,
    countyLabel: campus?.countyLabel ?? null,
    ready: !campusId ? false : !campusPending,
    requestPermission,
    setHereNow,
    setPaused,
    refresh,
    onTierChange,
  };
}
