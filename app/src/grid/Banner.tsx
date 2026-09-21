import { Banner as KitBanner, type BannerTone as KitBannerTone } from '../ui';

export interface BannerProps {
  message: string;
  actionLabel?: string | null;
  onAction?: () => void;
  busy?: boolean;
  tone?: 'info' | 'warning';
  testID?: string;
  actionTestID?: string;
}

const TONE_MAP: Record<'info' | 'warning', KitBannerTone> = {
  info: 'tint',
  warning: 'warning',
};

/**
 * The grid's persistent banners (paused, "you're not visible because…",
 * location pre-prompt, §3/§3.1/§5) — same props/testIDs this screen has
 * always used, now rendered through the design kit's `ui/Banner` (the tinted
 * info-panel pattern, `docs/design/system.md`'s component inventory) instead
 * of this file's own ad hoc styling. Kept as a thin wrapper, rather than
 * inlining `ui/Banner` at each call site in `(tabs)/grid.tsx`, so the
 * `tone="info"|"warning"` vocabulary this screen already uses doesn't have to
 * change everywhere `<Banner .../>` is used.
 */
export function Banner({ message, actionLabel, onAction, busy = false, tone = 'info', testID, actionTestID }: BannerProps) {
  return (
    <KitBanner
      testID={testID}
      actionTestID={actionTestID}
      tone={TONE_MAP[tone]}
      message={message}
      actionLabel={actionLabel ?? undefined}
      onAction={onAction}
      busy={busy}
    />
  );
}
