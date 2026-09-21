import { Button } from '../ui';

export interface ConfirmButtonProps {
  testID: string;
  label: string;
  busy: boolean;
  /** Disabled for a reason other than being busy (e.g. no category picked yet). */
  disabled?: boolean;
  /**
   * Kept for API compatibility with every existing call site (block confirm,
   * delete-account confirm, report submit, album delete) — none of the 24
   * screens render a filled-red button anywhere (`danger`/`colors.danger`
   * only ever shows up as ghost/link text, e.g. `Settings.html`'s "delete
   * my account"), so this no longer changes the fill colour. Every
   * consequential confirm action (`Profile-Report.html`'s "send report &
   * block", `Grid-Verify.html`'s "verify now") uses the same `.btn.secondary`
   * ink fill, which is what this always renders now.
   */
  destructive?: boolean;
  onPress: () => void;
}

/** A single final-action button (block, delete account, report submit, …) — `.btn.secondary`, the design's own shape for a consequential confirm. */
export function ConfirmButton({ testID, label, busy, disabled = false, onPress }: ConfirmButtonProps) {
  return (
    <Button
      testID={testID}
      label={label}
      variant="secondary"
      loading={busy}
      disabled={disabled}
      onPress={onPress}
    />
  );
}
