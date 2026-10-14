/**
 * Copying a code: write it, give a small buzz where phones support it, and
 * (if the setting is on) wipe it 30 seconds later -- by then the code is
 * dead anyway, and a stale code lingering in the clipboard is still a code.
 *
 * Limits, honestly: browsers only let a page write the clipboard while it is
 * in front, so a clear due while you're in another app simply doesn't happen
 * (and so never touches what you copied there). The page also can't read the
 * clipboard without a permission prompt, so it clears only if nothing newer
 * was copied from Pangolin itself.
 */
const CLEAR_AFTER_MS = 30_000;
let lastCopy = 0;

export async function copyCode(code: string, clearAfter: boolean): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    return false;
  }
  navigator.vibrate?.(12);
  const stamp = ++lastCopy;
  if (clearAfter) {
    window.setTimeout(() => {
      if (stamp === lastCopy && document.hasFocus()) navigator.clipboard.writeText("").catch(() => undefined);
    }, CLEAR_AFTER_MS);
  }
  return true;
}
