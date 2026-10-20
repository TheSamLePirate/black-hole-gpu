/** Nominal axial docking profile [m/s], before the hold and alignment corrections. */
export const nominalDockClosing = (along: number) => Math.min(3, 0.08 + 0.012 * Math.max(along, 0));

/** Excess closing rate against the signed command: the hub and cockpit share these limits. */
export function dockClosingMark(closing: number, asked: number): "warn" | "bad" | null {
  const excess = closing - asked;
  const speed = Math.abs(asked);
  return excess > speed * 0.5 + 0.02 ? "bad" : excess > speed * 0.25 + 0.01 ? "warn" : null;
}

/**
 * The approach's waypoints, as a visiting craft holds them on its way to the station (Dragon's Waypoint 1 at 220 m, its
 * Waypoint 2 at 20 m): the distance along the port's axis [m] and the hold there [s of the scene's time] — the crew's
 * go for the approach, then for the capture. Each only when the approach began beyond it.
 */
export const DOCK_WAYPOINTS: { along: number; hold: number; name: string }[] = [
  { along: 220, hold: 30, name: "WAYPOINT 1" },
  { along: 20, hold: 20, name: "WAYPOINT 2" },
];
