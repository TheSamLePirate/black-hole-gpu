/** Nominal axial docking profile [m/s], before the hold and alignment corrections. */
export const nominalDockClosing = (along: number) => Math.min(3, 0.08 + 0.012 * Math.max(along, 0));

/** Excess closing rate against the signed command: the hub and cockpit share these limits. */
export function dockClosingMark(closing: number, asked: number): "warn" | "bad" | null {
  const excess = closing - asked;
  const speed = Math.abs(asked);
  return excess > speed * 0.5 + 0.02 ? "bad" : excess > speed * 0.25 + 0.01 ? "warn" : null;
}
