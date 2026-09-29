import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { me as fetchMe, type MeResult } from '../../api/me';
import { getMyPresence, pauseGrid, setHereNow } from '../../api/presence';
import { listBlockedUsers } from '../../api/blocks';
import {
  getOrCreateNotificationPrefs,
  updateNotificationPrefs,
  type NotificationPrefsRow,
} from '../../api/notificationPrefs';
import { mapSupabaseError } from '../../api/errors';
import { usePresenceStore } from '../../presence/store';
import { queryKeys } from '../queryKeys';
import { getCampusDetail, getSchoolEmail, type CampusDetail } from './queries';
import { hiAndChatsOn, hiAndChatsUpdate, someoneNewNearbyUpdate } from './notificationGroups';

export interface UseSettingsDataResult {
  isLoading: boolean;
  meData: MeResult | null | undefined;
  campus: CampusDetail | null;
  schoolEmail: string | null;
  blockedCount: number;

  hereNow: boolean;
  paused: boolean;
  presenceError: string | null;
  onToggleHereNow: (next: boolean) => void;
  onTogglePause: (next: boolean) => void;

  hiAndChatsOn: boolean;
  someoneNewOn: boolean;
  notificationError: string | null;
  onToggleHiAndChats: (next: boolean) => void;
  onToggleSomeoneNew: (next: boolean) => void;
}

/**
 * Settings' own data + the three optimistic-with-rollback toggle pairs
 * (`docs/design/me-redesign/brief.md` rules: "optimistic writes with
 * rollback on failure; never block the UI on a round trip for a toggle").
 * `here now`/`pause my grid` mirror `usePresenceStore` (same store the Me
 * tab and the rest of the app already read/write, so they can never drift);
 * the two notification toggles optimistically patch the React Query cache
 * directly rather than a store, since nothing else in the app reads
 * `notification_prefs`.
 */
export function useSettingsData(): UseSettingsDataResult {
  const queryClient = useQueryClient();

  const meQuery = useQuery({ queryKey: queryKeys.me.result, queryFn: fetchMe });
  const meData = meQuery.data;
  const campusId = meData?.campus_id ?? null;

  const presenceQuery = useQuery({ queryKey: queryKeys.me.presence, queryFn: getMyPresence });
  const campusQuery = useQuery({
    queryKey: ['me_campus_detail', campusId],
    queryFn: () => getCampusDetail(campusId as string),
    enabled: !!campusId,
  });
  const schoolEmailQuery = useQuery({ queryKey: ['me_school_email'], queryFn: getSchoolEmail });
  const blockedQuery = useQuery({ queryKey: queryKeys.me.blockedUsers, queryFn: listBlockedUsers });
  const notificationPrefsQuery = useQuery({
    queryKey: queryKeys.me.notificationPrefs,
    queryFn: getOrCreateNotificationPrefs,
  });

  const hereNow = usePresenceStore((s) => s.hereNow);
  const paused = usePresenceStore((s) => s.paused);
  const [presenceError, setPresenceError] = useState<string | null>(null);
  const [notificationError, setNotificationError] = useState<string | null>(null);

  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || meData === undefined || presenceQuery.data === undefined) return;
    seeded.current = true;
    usePresenceStore.getState().setHereNow(!!meData?.here_now);
    usePresenceStore.getState().setPaused(presenceQuery.data?.is_visible === false);
  }, [meData, presenceQuery.data]);

  const onToggleHereNow = useCallback(
    (next: boolean) => {
      setPresenceError(null);
      const previous = hereNow;
      usePresenceStore.getState().setHereNow(next);
      setHereNow(next)
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.me.result });
        })
        .catch((error) => {
          usePresenceStore.getState().setHereNow(previous);
          setPresenceError(mapSupabaseError(error).message);
        });
    },
    [hereNow, queryClient]
  );

  const onTogglePause = useCallback(
    (next: boolean) => {
      setPresenceError(null);
      const previous = paused;
      usePresenceStore.getState().setPaused(next);
      // `pauseGrid`'s argument is `p_visible` — the inverse of "paused".
      pauseGrid(!next)
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.me.presence });
        })
        .catch((error) => {
          usePresenceStore.getState().setPaused(previous);
          setPresenceError(mapSupabaseError(error).message);
        });
    },
    [paused, queryClient]
  );

  function optimisticNotificationUpdate(patch: Partial<NotificationPrefsRow>) {
    const previous = notificationPrefsQuery.data;
    if (!previous) return null;
    const next = { ...previous, ...patch };
    queryClient.setQueryData(queryKeys.me.notificationPrefs, next);
    setNotificationError(null);
    return previous;
  }

  const onToggleHiAndChats = useCallback(
    (next: boolean) => {
      const patch = hiAndChatsUpdate(next);
      const previous = optimisticNotificationUpdate(patch);
      if (!previous) return;
      updateNotificationPrefs(patch).catch((error) => {
        queryClient.setQueryData(queryKeys.me.notificationPrefs, previous);
        setNotificationError(mapSupabaseError(error).message);
      });
    },
    [notificationPrefsQuery.data, queryClient]
  );

  const onToggleSomeoneNew = useCallback(
    (next: boolean) => {
      const patch = someoneNewNearbyUpdate(next);
      const previous = optimisticNotificationUpdate(patch);
      if (!previous) return;
      updateNotificationPrefs(patch).catch((error) => {
        queryClient.setQueryData(queryKeys.me.notificationPrefs, previous);
        setNotificationError(mapSupabaseError(error).message);
      });
    },
    [notificationPrefsQuery.data, queryClient]
  );

  return {
    // Aggregated across every query this hook reads (not just `me()`) — a
    // toggle handler bails out silently if its own query hasn't resolved
    // yet (`optimisticNotificationUpdate` has nothing to snapshot), so
    // callers (and this hook's own tests) need a single "safe to interact"
    // flag rather than guessing from one query's loading state.
    isLoading:
      meQuery.isLoading || presenceQuery.isLoading || notificationPrefsQuery.isLoading || blockedQuery.isLoading,
    meData,
    campus: campusQuery.data ?? null,
    schoolEmail: schoolEmailQuery.data ?? null,
    blockedCount: blockedQuery.data?.length ?? 0,

    hereNow,
    paused,
    presenceError,
    onToggleHereNow,
    onTogglePause,

    hiAndChatsOn: notificationPrefsQuery.data ? hiAndChatsOn(notificationPrefsQuery.data) : true,
    someoneNewOn: notificationPrefsQuery.data?.someone_new_nearby ?? false,
    notificationError,
    onToggleHiAndChats,
    onToggleSomeoneNew,
  };
}
